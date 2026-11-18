from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def test_runtime_network_targets():
    py = ROOT/'local-ai-engine/manga_engine'
    backend = '\n'.join(p.read_text() for p in py.glob('*.py'))
    assert set(re.findall(r'https?://[a-zA-Z0-9.:_-]+',backend)) == {'http://127.0.0.1:11434'}
    assert 'ProxyHandler({})' in backend and 'HTTPRedirectHandler' in backend
    assert 'host="127.0.0.1"' in backend and '/api/pull' not in backend
    ext = ROOT/'extension'
    worker = (ext/'src/worker.ts').read_text()
    manifest = json.loads((ext/'dist/manifest.json').read_text())
    assert 'http://127.0.0.1:18787' in worker and 'redirect: \'error\'' in worker
    assert manifest['host_permissions'] == ['http://127.0.0.1/*']
    assert not manifest.get('externally_connectable')
    assert 'credentials: \'omit\'' in worker
    requirements = (ROOT/'local-ai-engine/requirements.txt').read_text().lower()
    assert not any(package in requirements for package in ['openai','anthropic','deepl','boto3','google-cloud','stripe','azure','google-genai'])
