import base64
from io import BytesIO
import json
import os
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image
import pytest

from manga_engine.contracts import Settings
from manga_engine.identity import EXTENSION_ORIGIN

FIXTURES = Path(__file__).parent/'fixtures'
LIVE = os.environ.get('MANGA_TEST_TOKEN_FILE')
pytestmark = pytest.mark.skipif(not LIVE, reason='Set MANGA_TEST_TOKEN_FILE and start Ollama plus local companion')


def api(route, payload=None, method=None, origin=EXTENSION_ORIGIN, authenticated=True):
    headers = {'Origin':origin,'Content-Type':'application/json'}
    if authenticated:
        headers['Authorization'] = 'Bearer ' + Path(LIVE).read_text().strip()
    request = Request('http://127.0.0.1:18787'+route, json.dumps(payload).encode() if payload is not None else None, headers,method=method)
    with urlopen(request,timeout=22) as response:
        return json.load(response)


def run(route, payload):
    key = api(route,payload)['id']
    deadline = time.monotonic()+245
    while time.monotonic() < deadline:
        status = api('/jobs/'+key)
        if status['state'] == 'done':
            return status['result']
        assert status['state'] in {'running','pending'}, status
        time.sleep(.6)
    pytest.fail('Local job timeout')


@pytest.mark.parametrize('lang,name,source,translations',[
    ('en','english',['GOOD MORNING!', "LET'S GO HOME.", 'THANK YOU!'],['sáng','về','cảm ơn']),
    ('ja','japanese',['おはよう!', 'ありがとう','行こう!'],['sáng','cảm ơn','đi']),
])
def test_real_recognition_translation_render_and_cache(lang,name,source,translations):
    image = (FIXTURES/(name+'.png')).read_bytes()
    payload = {'image':base64.b64encode(image).decode(), 'settings':Settings(language=lang,device='cpu').model_dump(),'force':True}
    start = time.monotonic()
    job = run('/jobs', payload)
    page = api('/result/'+job['key'])
    print(f'{lang} {time.monotonic()-start:.2f}s, {page["rendered"]} regions, '
          + str([(r['id'],r['source'],r['text'],r['issue']) for r in page['regions']]))
    assert [r['source'] for r in page['regions']] == source
    assert all(expected in region['text'].lower() for expected,region in zip(translations,page['regions'])), page['regions']
    assert page['image'] and page['rendered'] == 3
    assert 'translation_base' not in page and 'translation_key' not in page
    evidence = os.environ.get('MANGA_EVIDENCE_DIR')
    if evidence:
        folder = Path(evidence)
        folder.mkdir(parents=True,exist_ok=True)
        (folder/(name+'-vi.png')).write_bytes(base64.b64decode(page['image']))
    assert Image.open(BytesIO(base64.b64decode(page['image']))).size == Image.open(BytesIO(image)).size
    payload['force'] = False
    again = run('/jobs',payload)
    assert again['cached'] and again['key'] == page['key']
    if lang == 'en':
        edit = {'id':'r1','text':'Chào buổi sáng nhé!', 'font':'bold'}
        saved = run('/edit/'+page['key'],{'edit':edit})
        assert api('/result/'+saved['key'])['regions'][0]['text'] == edit['text']
        run('/edit/'+page['key'],{'edit':edit,'reset':True})
        assert api('/result/'+page['key'])['regions'][0]['text'] == page['regions'][0]['text']
        payload['settings']['font'] = 'bold'
        start = time.monotonic()
        styled = run('/jobs',payload)
        bold = api('/result/'+styled['key'])
        print(f'Font redraw {time.monotonic()-start:.2f}s, {bold["rendered"]} regions')
        assert bold['rendered'] == 3 and bold['image'] != page['image']
        assert [r['text'] for r in bold['regions']] == [r['text'] for r in page['regions']]


def test_auth_origin_audit():
    for kwargs, status in [({'origin':'https://reader.example'},403),({'authenticated':False},401)]:
        with pytest.raises(HTTPError) as error:
            api('/health',**kwargs)
        assert error.value.code == status
    health = api('/health')
    assert health['ollama'] and health['manga_ocr'] and Settings().model in health['models']
    assert isinstance(health['loaded'],list)
    with pytest.raises(HTTPError) as denied:
        api('/glossary',['not-a-glossary'])
    assert denied.value.code == 422
