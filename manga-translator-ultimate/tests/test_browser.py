from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import os
from pathlib import Path
from threading import Thread

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright
import pytest

from manga_engine.identity import EXTENSION_ORIGIN

ROOT = Path(__file__).resolve().parents[1]
LIVE = os.environ.get('MANGA_TEST_TOKEN_FILE')
pytestmark = pytest.mark.skipif(not LIVE, reason='Set MANGA_TEST_TOKEN_FILE to run Chromium with the real engine')
HTML = '''<!doctype html><meta charset=utf-8><title>Local manga test</title>
<style>
body{margin:0;background:#ddd} #lead{height:35px} #reader{height:620px;overflow:auto;background:#eee;margin:0 auto;width:min(95vw,760px)}
picture{display:block} img{width:92%;height:auto;display:block;margin:auto} #gap{height:1100px}
.csp :is(img,canvas#p){display:block;margin:auto;width:570px;height:550px;object-fit:contain;object-position:28% 61%;transform:translate(3px,5px) scale(.94)}
</style><div id=lead></div><div id=reader><picture><source srcset="/english.png"><img id=p src="/english.png" width="720" height="960"></picture>
<div id=gap></div><div id=late></div></div><script src=/fixture.js></script>'''
SCRIPT = '''window.lazy = () => {
 let i=document.createElement('img'); i.id='lazy'; i.loading='lazy'; i.width=720;i.height=960;i.src='/english.png';
 document.querySelector('#late').append(i);
};
window.replacePage=()=>{const old=document.querySelector('#p'); const next=document.createElement('img');
next.id='p';next.src='/english.png'; next.width=720;next.height=960;old.replaceWith(next);};
window.chapter=()=>{history.pushState({},'', '/chapter-2');window.replacePage();};
if(location.pathname==='/canvas'){
 const source=new Image();source.onload=()=>{document.querySelector('#p').getContext('2d').drawImage(source,0,0);
 document.querySelector('#p').dataset.ready='1';};source.src='/english.png';
}'''


@contextmanager
def fixture_server():
    root = ROOT/'tests'/'fixtures'
    class Server(BaseHTTPRequestHandler):
        def do_GET(self):
            path = self.path.split('?',1)[0]
            if path in ['/english.png','/japanese.png']:
                raw = (root/path[1:]).read_bytes()
                mimetype = 'image/png'
            elif path == '/fixture.js':
                raw,mimetype = SCRIPT.encode(),'text/javascript'
            elif path == '/favicon.ico':
                self.send_error(404)
                return
            else:
                raw,mimetype = HTML.encode(),'text/html; charset=utf-8'
                if path == '/density':
                    raw = raw.replace(b'srcset="/english.png"', b'srcset="/english.png 2x"')
                if path == '/csp':
                    raw = raw.replace(b'<div id=lead>',b'<body class=csp><div id=lead>')
                if path == '/canvas':
                    raw = raw.replace(b'<div id=lead>',b'<body class=csp><div id=lead>')
                    raw = raw.replace(b'<picture><source srcset="/english.png"><img id=p src="/english.png" width="720" height="960"></picture>',
                                      b'<canvas id=p width=720 height=960></canvas>')
            self.send_response(200)
            self.send_header('Content-Type',mimetype)
            self.send_header('Content-Length',str(len(raw)))
            if path == '/csp':
                self.send_header('Content-Security-Policy',"default-src 'self'; style-src 'unsafe-inline'")
            self.end_headers()
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass
        def log_message(self,*args):
            pass
    with ThreadingHTTPServer(('127.0.0.1',0),Server) as http:
        thread = Thread(target=http.serve_forever,daemon=True)
        thread.start()
        try:
            yield f'http://127.0.0.1:{http.server_port}'
        finally:
            http.shutdown()
            thread.join()


def tab_command(worker, tab_id, action, value=None):
    answer = worker.evaluate('([id,action,value])=>chrome.tabs.sendMessage(id,{type:"command",action,value})', [tab_id,action,value])
    assert answer['ok'], answer
    return answer['value']


def changed(source):
    return 'document.querySelector('+repr(source)+').currentSrc.startsWith("blob:")'


def screenshot(page, selector):
    # Screenshot only the stable visible band to avoid Playwright auto-scrolling the reader.
    rect = page.locator(selector).bounding_box()
    return Image.open(BytesIO(page.screenshot(clip={
        'x':round(rect['x']+rect['width']*.51),'y':round(rect['y'])+25,'width':220,'height':180}))).convert('RGB')


def geometry(page):
    return page.locator('#p').evaluate('i=>{const r=i.getBoundingClientRect();return [r.x,r.y,r.width,r.height,i.naturalWidth,i.naturalHeight]}')


def stable(before, after):
    assert max(abs(x-y) for x,y in zip(before[:4],after[:4])) <= 2, (before,after)
    assert before[4:] == after[4:]


def test_mv3_image_anchor_and_reader(tmp_path):
    dist = ROOT/'extension'/'dist'
    with fixture_server() as url, sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            tmp_path/'profile', executable_path=os.environ.get('CHROMIUM_BIN',playwright.chromium.executable_path),
            headless=True, ignore_default_args=['--disable-extensions'], viewport={'width':980,'height':820},
            args=['--no-sandbox','--disable-background-networking',f'--disable-extensions-except={dist}',f'--load-extension={dist}'])
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        requests = []
        context.on('request',lambda request: requests.append(request.url))
        assert worker.url.startswith(EXTENSION_ORIGIN)
        worker.evaluate('token=>chrome.storage.local.set({token,settings:{language:"en",device:"cpu"}})', Path(LIVE).read_text().strip())
        worker.evaluate('chrome.scripting.registerContentScripts([{id:"fixture",matches:["http://127.0.0.1/*"],js:["content.js"],runAt:"document_idle"}])')
        page = context.pages[0]
        page.goto(url+'/chapter-1')
        tab_id = worker.evaluate('async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id',page.url)
        page.wait_for_function('document.querySelector("#p").naturalWidth === 720')
        base = geometry(page)
        ink = screenshot(page,'#p')
        tab_command(worker,tab_id,'chapter')
        try:
            page.wait_for_function(changed('#p'),timeout=130000)
        except Exception as exc:
            pytest.fail(f'Image replacement absent: {tab_command(worker,tab_id,"status")}: {exc}')
        stable(base,geometry(page))
        result = screenshot(page,'#p')
        evidence = os.environ.get('MANGA_EVIDENCE_DIR')
        if evidence:
            folder = Path(evidence)
            folder.mkdir(parents=True,exist_ok=True)
            ink.save(folder/'chromium-original.png')
            result.save(folder/'chromium-translated.png')
        assert ImageChops.difference(ink,result).getbbox()
        # Browser zoom is set through the tabs API, so it exercises the actual zoom path.
        for ratio in [.8,1,1.25,1.5,1]:
            actual = worker.evaluate('async ([id,z])=>{await chrome.tabs.setZoom(id,z);return await chrome.tabs.getZoom(id)}',[tab_id,ratio])
            assert abs(actual-ratio) < .03
            page.wait_for_timeout(160)
            before = geometry(page)
            tab_command(worker,tab_id,'show',False)
            page.wait_for_function('!('+changed('#p')+')')
            stable(before,geometry(page))
            tab_command(worker,tab_id,'show',True)
            page.wait_for_function(changed('#p'),timeout=12000)
            stable(before,geometry(page))
        for width,height in [(790,750),(1100,900),(680,720),(980,820)]:
            page.set_viewport_size({'width':width,'height':height})
            before = geometry(page)
            tab_command(worker,tab_id,'show',False)
            page.wait_for_function('!('+changed('#p')+')')
            stable(before,geometry(page))
            tab_command(worker,tab_id,'show',True)
            page.wait_for_function(changed('#p'),timeout=12000)
        page.evaluate('''async () => {
          const r=document.querySelector('#reader');
          for(let i=0;i<100;i++) {r.scrollTop+=5; await new Promise(requestAnimationFrame)}
          for(let i=0;i<100;i++) {r.scrollTop-=5; await new Promise(requestAnimationFrame)}
          r.scrollTop=350; await new Promise(requestAnimationFrame); r.scrollTop=0;
        }''')
        page.wait_for_function(changed('#p'))
        assert ImageChops.difference(result,screenshot(page,'#p')).getbbox() is None
        page.evaluate("document.querySelector('#lead').style.height='73px'")
        new = geometry(page)
        assert abs(new[1]-base[1]-38) <= 2
        stable([base[0],base[1]+38,*base[2:]],new)
        page.evaluate('window.lazy(); document.querySelector("#reader").scrollTop=2100;')
        page.wait_for_function(changed('#lazy'),timeout=12000)
        page.evaluate('document.querySelector("#reader").scrollTop=0;window.replacePage()')
        page.wait_for_function(changed('#p'),timeout=12000)
        page.evaluate('window.chapter()')
        page.wait_for_url('**/chapter-2')
        page.wait_for_function(changed('#p'),timeout=12000)
        other = context.new_page()
        other.goto('about:blank')
        page.bring_to_front()
        assert page.evaluate(changed('#p'))
        page.reload()
        page.wait_for_function(changed('#p'),timeout=12000)
        page.goto(url+'/density')
        page.wait_for_function('document.querySelector("#p").naturalWidth === 360')
        before_density = geometry(page)
        page.wait_for_function(changed('#p'),timeout=15000)
        stable(before_density,geometry(page))
        # Site CSP blocks the normal blob replacement, so the same artwork is
        # drawn into a tracked, pointer-transparent canvas layer.
        page.goto(url+'/csp')
        page.wait_for_function('''() => document.querySelector("#p").currentSrc.startsWith("blob:") ||
                                                !!document.querySelector("canvas[data-mtu-overlay]")''',timeout=14000)
        # A same-origin canvas always takes the attached-canvas path. Its
        # rendered bytes differ from the PNG resource encoding.
        page.goto(url+'/canvas')
        page.wait_for_function('document.querySelector("#p").dataset.ready === "1"')
        try:
            page.locator('canvas[data-mtu-overlay]').wait_for(timeout=115000)
        except Exception as exc:
            pytest.fail(f'No canvas overlay: {tab_command(worker,tab_id,"status")}: {exc}')
        for width,height,offset in [(980,820,0),(870,780,180),(1100,820,0)]:
            page.set_viewport_size({'width':width,'height':height})
            page.locator('#reader').evaluate('(r,y)=>r.scrollTop=y',offset)
            page.wait_for_timeout(150)
            image = page.locator('#p').bounding_box()
            layer = page.locator('canvas[data-mtu-overlay]').bounding_box()
            assert max(abs(image[k]-layer[k]) for k in ['x','y','width','height']) <= 2, (image,layer)
            assert page.locator('canvas[data-mtu-overlay]').evaluate('x=>getComputedStyle(x).objectPosition') == '28% 61%'
        tab_command(worker,tab_id,'show',False)
        assert page.locator('canvas[data-mtu-overlay]').count()==0
        assert page.locator('#p').evaluate('i=>getComputedStyle(i).opacity') == '1'
        # A one-request loopback outage exercises reconnect and backoff without
        # changing the companion or replacing model/rendering responses.
        worker.evaluate('''() => {
            const upstream=self.fetch.bind(self);
            self.fetch=(input,options)=>{
                if(String(input)==='http://127.0.0.1:18787/jobs'){
                    self.fetch=upstream;
                    self.reconnectInjected=true;
                    return Promise.reject(new TypeError('test outage'));
                }
                return upstream(input,options);
            };
        }''')
        page.goto(url+'/reconnect')
        page.wait_for_function(changed('#p'),timeout=20000)
        assert worker.evaluate('self.reconnectInjected === true')
        options = context.new_page()
        options.goto(EXTENSION_ORIGIN+'/settings.html')
        options.get_by_text('Engine và Ollama đã kết nối.',exact=False).wait_for(timeout=10000)
        assert options.locator('#model').input_value().startswith('qwen3:')
        options.locator('#auto').uncheck()
        options.get_by_role('button',name='Lưu hồ sơ').click()
        options.get_by_text('Đã lưu hồ sơ.').wait_for()
        assert not tab_command(worker,tab_id,'status')['auto']
        options.close()
        assert all(req.startswith((url,EXTENSION_ORIGIN,'http://127.0.0.1:18787','blob:','data:')) for req in requests), requests
        context.close()
