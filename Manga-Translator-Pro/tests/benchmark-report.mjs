import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const args = process.argv.slice(2);
function argument(name) { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; }
if (args.includes('--help')) {
  console.log('npm run benchmark -- [--observations path.json] [--reference path.json] [--out work/phase050/benchmark-report.json]');
  console.log('No input means unmeasured. Supplied provenance must distinguish live-provider, reference-extension, mock or renderer-fixture.');
  process.exit(0);
}
const bundled = await build({ entryPoints: [resolve('src/benchmark/metrics.ts')], bundle: true, format: 'esm', platform: 'node', target: 'node22', write: false });
const metrics = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const dataset = JSON.parse(await readFile('tests/fixtures/multilingual/dataset.json', 'utf8'));
const unmeasured = (reason) => ({ status: 'unmeasured', value: null, reason });
const measured = (value, evidence) => ({ status: 'measured', value, evidence });
const supportedKinds = ['live-provider', 'reference-extension', 'mock', 'renderer-fixture', 'manual'];

async function load(path) {
  if (!path) return undefined;
  const content = JSON.parse(await readFile(path, 'utf8'));
  if (!content.provenance || !supportedKinds.includes(content.provenance.kind) || typeof content.provenance.description !== 'string' || !content.provenance.description.trim()) {
    throw new TypeError('Observation file requires explicit provenance.kind and description; mock input cannot be labelled live evidence.');
  }
  if (!Array.isArray(content.images)) throw new TypeError('Observation images must be an array, including an explicit empty array when none were collected.');
  const known = new Set(dataset.images.map((image) => image.id)), seen = new Set();
  for (const image of content.images) {
    if (!known.has(image.id) || seen.has(image.id) || !Array.isArray(image.regions)) throw new TypeError('Observation image IDs must be unique known dataset IDs with a regions array.');
    seen.add(image.id);
    for (const region of image.regions) {
      const box = region.box;
      if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > 1.000001 || box.y + box.height > 1.000001) throw new TypeError('Observation boxes must be finite normalized source-image coordinates.');
    }
  }
  return { ...content, provenance: { kind: content.provenance.kind, description: content.provenance.description,
    ...(typeof content.provenance.model === 'string' ? { model: content.provenance.model.slice(0, 200) } : {}),
    ...(typeof content.provenance.recordedAt === 'string' ? { recordedAt: content.provenance.recordedAt.slice(0, 100) } : {}) } };
}

function evaluate(observation) {
  const evidence = observation ? `${observation.provenance.kind}: ${observation.provenance.description}` : '';
  const isLive = Boolean(observation && ['live-provider', 'reference-extension'].includes(observation.provenance.kind));
  const result = {
    imageDiscoveryRecall: unmeasured('No recorded discovery observations.'),
    textRegionDetectionRecall: unmeasured('No live provider/reference outputs supplied; fixture annotations are not detection results.'),
    ocrAccuracy: unmeasured('No live OCR sourceText supplied. Mock/rendered translations are not OCR evidence.'),
    translationQuality: unmeasured('Needs attributed human adequacy, fluency and terminology reviews on real output. Reference strings alone are not a quality score.'),
    regionPositionError: unmeasured('Needs expected and observed rendered CSS-pixel geometry.'),
    textOverflowRate: unmeasured('No rendered text overflow observations.'),
    cacheHitRate: unmeasured('No cache lookup telemetry supplied.'),
    duplicateApiRequestCount: unmeasured('No content/profile/crop-scoped request telemetry supplied.'),
    memoryUsage: unmeasured('No memory observation. JSON metadata bytes are not heap, process RAM or peak RAM.'),
    timeToTranslateChapter: unmeasured('No chapter start/end telemetry supplied.'),
  };
  if (!observation) return { provenance: { kind: 'unmeasured', description: 'Dataset and metric plumbing only; no Gemini or reference extension was executed.' }, metrics: result };
  if (Array.isArray(observation.discovery?.foundImageIds)) {
    const found = new Set(observation.discovery.foundImageIds.filter((id) => dataset.images.some((image) => image.id === id)));
    result.imageDiscoveryRecall = measured({ found: found.size, expected: dataset.images.length, recall: metrics.ratio(found.size, dataset.images.length) }, evidence);
  }
  if (isLive) {
    let expectedCount = 0, detectedCount = 0, matchedCount = 0, referenceCharacters = 0, characterErrors = 0, exactRegions = 0;
    let textAvailable = true;
    for (const image of dataset.images) {
      const prediction = observation.images.find((candidate) => candidate.id === image.id);
      if (!prediction) continue; // Untested pages are not silently counted as successful or failed predictions.
      const detection = metrics.detectionMetrics(image.regions, prediction.regions);
      expectedCount += detection.expected; detectedCount += detection.detected; matchedCount += detection.matched;
      if (!prediction.regions.every((region) => typeof region.sourceText === 'string')) textAvailable = false;
      else {
        const ocr = metrics.ocrMetrics(image.regions, prediction.regions);
        referenceCharacters += ocr.referenceCharacters; characterErrors += ocr.characterErrors; exactRegions += ocr.exactRegions;
      }
    }
    if (expectedCount) result.textRegionDetectionRecall = measured({ testedImages: observation.images.length, datasetImages: dataset.images.length,
      expectedRegions: expectedCount, predictedRegions: detectedCount, matchedRegions: matchedCount, iouThreshold: .5,
      recall: metrics.ratio(matchedCount, expectedCount), precision: metrics.ratio(matchedCount, detectedCount) }, evidence);
    if (expectedCount && textAvailable && referenceCharacters) result.ocrAccuracy = measured({ normalization: 'NFC; trim outer whitespace; preserve interior whitespace; Unicode code points',
      referenceCharacters, characterErrors, characterErrorRate: characterErrors / referenceCharacters, exactRegionRate: exactRegions / expectedCount }, evidence);
    if (Array.isArray(observation.humanTranslationReviews) && observation.humanTranslationReviews.length) {
      result.translationQuality = measured(metrics.humanTranslationSummary(observation.humanTranslationReviews), evidence);
    }
  }
  const samples = observation.renderer?.samples;
  if (Array.isArray(samples) && samples.length) {
    const visible = samples.filter((sample) => sample.expected && sample.actual);
    const errors = visible.map((sample) => metrics.regionPositionErrorCssPx(sample.expected, sample.actual));
    result.regionPositionError = measured({ samples: samples.length, visibleSamples: visible.length, missingLayers: samples.length - visible.length,
      maxErrorCssPx: errors.length ? Math.max(...errors) : null, meanErrorCssPx: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null }, evidence);
    const overflow = samples.filter((sample) => typeof sample.overflow === 'boolean').map((sample) => sample.overflow);
    if (overflow.length) result.textOverflowRate = measured({ samples: overflow.length, rate: metrics.overflowRate(overflow),
      unreadableSamples: samples.filter((sample) => sample.readable === false).length }, evidence);
  }
  const runtime = observation.runtime;
  if (runtime?.cache && Number.isInteger(runtime.cache.hits) && Number.isInteger(runtime.cache.lookups)) result.cacheHitRate = measured({ ...runtime.cache, rate: metrics.cacheHitRate(runtime.cache.hits, runtime.cache.lookups) }, evidence);
  if (Array.isArray(runtime?.apiRequests)) result.duplicateApiRequestCount = measured(metrics.apiRequestSummary(runtime.apiRequests), evidence);
  if (runtime?.memory && typeof runtime.memory.scope === 'string') {
    const memory = runtime.memory;
    const knownFields = ['metadataBytes', 'jsHeapUsedBytes', 'jsHeapTotalBytes'];
    for (const key of knownFields) if (memory[key] !== undefined && (!Number.isFinite(memory[key]) || memory[key] < 0)) throw new TypeError('Memory values must be non-negative bytes.');
    result.memoryUsage = measured({ scope: memory.scope,
      ...Object.fromEntries(knownFields.filter((key) => memory[key] !== undefined).map((key) => [key, memory[key]])),
      peakProcessRam: 'unmeasured; JS heap samples exclude decoded images/GPU/offscreen memory' }, evidence);
  }
  if (Number.isFinite(runtime?.chapter?.startedAtMs) && Number.isFinite(runtime?.chapter?.finishedAtMs)) {
    result.timeToTranslateChapter = measured({ elapsedMs: metrics.elapsedMs(runtime.chapter.startedAtMs, runtime.chapter.finishedAtMs),
      includesRealProvider: isLive && observation.provenance.kind === 'live-provider' }, evidence);
  }
  return { provenance: observation.provenance, metrics: result };
}

const observation = await load(argument('--observations'));
const reference = await load(argument('--reference'));
if (reference && reference.provenance.kind !== 'reference-extension') throw new TypeError('Reference comparison requires declared reference-extension provenance; mock evidence cannot prove parity.');
const report = { formatVersion: 'mtp-benchmark-v1', generatedAt: new Date().toISOString(),
  dataset: { version: dataset.version, images: dataset.images.length, languages: dataset.images.map((image) => image.language), regions: dataset.images.reduce((sum, image) => sum + image.regions.length, 0),
    license: dataset.license, representativeRealMangaAccuracy: false },
  output: evaluate(observation), ...(reference ? { reference: evaluate(reference), comparison: 'Same annotated dataset; supplied provenance is declared by the operator, not independently verified. No 100% parity conclusion is calculated.' } : { referenceComparison: 'unmeasured: no observed reference-extension outputs supplied' }),
};
const outputPath = resolve(argument('--out') ?? 'work/phase050/benchmark-report.json');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, provenance: report.output.provenance,
  measuredMetrics: Object.entries(report.output.metrics).filter(([, item]) => item.status === 'measured').map(([key]) => key),
  unmeasuredMetrics: Object.entries(report.output.metrics).filter(([, item]) => item.status === 'unmeasured').map(([key]) => key) }, null, 2));
