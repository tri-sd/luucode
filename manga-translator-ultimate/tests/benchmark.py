import sys
from pathlib import Path
from time import perf_counter

from manga_engine.contracts import Settings
from manga_engine.engine import read_image
from manga_engine.ocr import Ocr
from manga_engine.translate import installed, request_translation

ocr = Ocr()
samples = {}
for lang, fixture in [('en', 'english'), ('ja', 'japanese')]:
    start = perf_counter()
    rgb, _ = read_image((Path(__file__).parent / 'fixtures' / (fixture+'.png')).read_bytes())
    regions = ocr.regions(rgb, Settings(language=lang), lambda: None)
    samples[lang] = [r for r in regions if not r.issue]
    print(lang, round(perf_counter()-start, 2), [(r.id, r.source, round(r.confidence, 2), r.issue) for r in regions], flush=True)
for model in sys.argv[1:] or [Settings().model, 'qwen2.5:1.5b-instruct-q4_K_M']:
    print(installed(model)['name'], flush=True)
    for lang, regions in samples.items():
        if not regions:
            continue
        start = perf_counter()
        print(lang, request_translation(regions, Settings(model=model), '', {}, 'cpu'),
              round(perf_counter()-start, 2), flush=True)
