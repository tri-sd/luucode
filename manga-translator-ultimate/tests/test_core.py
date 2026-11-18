import json
import time
from urllib.error import HTTPError

import cv2
import numpy as np
from PIL import Image
import pytest

from manga_engine.cache import Cache
from manga_engine.contracts import Region, Settings
from manga_engine.jobs import Jobs
from manga_engine.ocr import normalize, ordered, tiles
from manga_engine.render import erase_patch, layout, render
import manga_engine.translate as translator


def region(id='r1', text='GOOD MORNING!', language='en'):
    return Region(id=id, orientation='horizontal', source=text, language=language,
                  box=(.1,.2,.8,.6), polygons=[])


def test_schema_reorders_and_rejects_invalid_ids():
    first, second = region(), region('r2', 'Thank you!')
    one, two = {'id':'r1','text':'Chào buổi sáng!'}, {'id':'r2','text':'Cảm ơn bạn!'}
    def check(*items):
        return translator.validate(json.dumps({'translations':items}), [first, second], {})
    out, rejected = check(two, one)
    assert out == {'r1':one['text'],'r2':two['text']} and not rejected
    assert set(check(one)[0]) == {'r1'}
    for bad in [(one,one),(one,{'id':'r3','text':'Cảm ơn'})]:
        with pytest.raises(ValueError):
            check(*bad)
    values, issues = check({'id':'r1','text':'Good morning!'}, {'id':'r2','text':'ありがとう'})
    assert not values and set(issues) == {'r1','r2'}


def test_greeting_does_not_drop_time_of_day():
    items = [region('r1','おはよう!', 'ja'), region('r2','Good evening!')]
    output, rejected = translator.validate(
        '{"translations":[{"id":"r1","text":"Xin chào!"},{"id":"r2","text":"Chào buổi tối!"}]}',items,{})
    assert output == {'r2':'Chào buổi tối!'}
    assert list(rejected) == ['r1']


def test_glossary_and_retry_keeps_valid_results(monkeypatch):
    a, b = region('r1', 'Haru is here'), region('r2', 'Thanks!')
    attempts = []
    def fake(batch, settings, context, glossary, device, **kwargs):
        attempts.append([r.id for r in batch])
        if len(batch) == 2:
            return translator.validate('{"translations":[{"id":"r1","text":"Haru đến rồi"}]}', batch, glossary)
        return {'r2':'Cảm ơn!'}, {}
    monkeypatch.setattr(translator, 'request_translation', fake)
    translator.translate([a,b], Settings(), '', {'Haru':'Haru'}, lambda:None)
    assert attempts == [['r1','r2'], ['r2']]
    assert a.text == 'Haru đến rồi' and b.text == 'Cảm ơn!'


def test_batch_size_respects_text_length():
    items = [region(f'r{i}', 'a'*460) for i in range(1,6)]
    assert [len(batch) for batch in translator.batches(items,'balanced')] == [2,2,1]
    assert [len(batch) for batch in translator.batches(items,'low')] == [1,1,1,1,1]


def test_gpu_error_retries_cpu(monkeypatch):
    devices = []
    def fake(batch, settings, context, glossary, device, **kwargs):
        devices.append(device)
        if device == 'auto':
            raise HTTPError(translator.BASE+'/api/chat', 500, 'out of memory', None, None)
        return {'r1': 'Chào buổi sáng!'}, {}
    monkeypatch.setattr(translator, 'request_translation', fake)
    item = region()
    assert translator.translate([item],Settings(),'',{},lambda:None) == 'cpu'
    assert devices == ['auto','cpu'] and item.text


def test_japanese_order_and_tiling():
    groups = [((10,5,30,45), None, 'left'), ((105,12,160,60), None, 'right'), ((20,100,90,120), None, 'next')]
    assert [name for _,_,name in ordered(groups,True)] == ['right','left','next']
    assert [name for _,_,name in ordered(groups,False)] == ['left','right','next']
    xs = np.zeros((3600, 840), np.uint8)
    hits = np.zeros_like(xs)
    for x,y,part in tiles(xs, 1024):
        hits[y:y+part.shape[0], x:x+part.shape[1]] = 1
    assert hits.min() == 1


def example_patch():
    img = np.full((160,300,3), (246,234,188), dtype=np.uint8)
    cv2.rectangle(img,(10,10),(289,149),(27,22,38),2)
    cv2.putText(img,'MORNING',(64,94),cv2.FONT_HERSHEY_SIMPLEX,1.1,(22,22,22),2,cv2.LINE_AA)
    x,y,r,b = 58,59,228,102
    item = Region(id='r1', orientation='horizontal', source='MORNING', text='Chào buổi sáng!',
                  box=normalize((x,y,r,b),300,160),bubble=normalize((11,11,289,149),300,160),
                  polygons=[[(a/300,t/160) for a,t in [(x,y),(r,y),(r,b),(x,b)]]])
    return img,item


def test_inpaint_and_vietnamese_layout_keep_border():
    img,item = example_patch()
    xy, patch, bg, mask = erase_patch(img,item,False)
    assert mask.any() and np.max(np.abs(np.median(patch[mask>0],axis=0)-bg)) < 8
    assert np.max(patch[mask>0])-np.min(patch[mask>0]) <= 75
    output,count = render(img,[item],Settings(),lambda:None)
    assert count == 1 and output.shape == img.shape and np.array_equal(output[:12],img[:12])
    assert not np.array_equal(output,img)
    for style in ['regular','bold','italic']:
        face, lines = layout('Tiếng Việt rất đẹp', (15,15,245,120),style,1,True)
        assert face.getmask('ắ').getbbox() is not None and lines
    assert layout('x'*300,(5,5,35,22),'regular',1,False) is None


def test_cache_lru_corrections_and_reopen(tmp_path):
    path = tmp_path/'cache.sqlite3'
    cache = Cache(path, 44)
    cache.put('a',b'original',b'X'*20,{}, {'r1':{'text':'Chào'}})
    cache.put('b',b'original',b'Y'*20,{})
    assert cache.page('a') is None and cache.page('b')[0] == b'Y'*20
    assert Cache(path,44).corrections('a')['r1']['text'] == 'Chào'
    cache.glossary({'cat':'mèo'})
    cache.clear()
    assert Cache(path,44).glossary() == {'cat':'mèo'} and cache.corrections('a')


def test_queue_cancellation_and_next_job():
    jobs = Jobs()
    def work(check, progress):
        while True:
            check()
            time.sleep(.01)
    key = jobs.submit(work)
    jobs.cancel(key)
    done = jobs.submit(lambda check, progress: {'key':'finished'})
    deadline = time.monotonic()+2
    while jobs.status(done)['state'] != 'done':
        assert time.monotonic() < deadline
        time.sleep(.01)
    assert jobs.status(key)['state'] == 'cancelled'
    jobs.pool.shutdown()


def test_recovers_undetected_balloon_line_without_erasing_art(monkeypatch):
    from pathlib import Path
    from manga_engine.ocr import Ocr
    rgb = np.asarray(Image.open(Path(__file__).parent / 'fixtures/english.png').convert('RGB'))
    # Simulate the detector finding GOOD but entirely missing MORNING!
    box = np.array([(419,88),(520,88),(520,123),(419,123)], dtype=np.int32)
    ocr = Ocr()
    monkeypatch.setattr(ocr, 'detect', lambda *args: [box])
    item, = ocr.regions(rgb, Settings(language='en'), lambda: None)
    assert item.source == 'GOOD MORNING!'
    assert item.balloon_outline
    (x,y,r,d), repaired, _, mask = erase_patch(rgb,item,False)
    assert y < 148 < d
    original = rgb[y:d,x:r]
    missed_ink = (original[:,:,0] < 100) & ((np.arange(y,d)[:,None] > 129) & (np.arange(y,d)[:,None] < 158)) & (np.arange(x,r)[None,:] > 370) & (np.arange(x,r)[None,:] < 570)
    assert missed_ink.any() and np.mean(mask[missed_ink] > 0) > .95
    assert np.median(repaired[missed_ink]) > 230
    item.text = 'Chào buổi sáng!'
    output, rendered = render(rgb,[item],Settings(language='en'),lambda:None)
    assert rendered == 1
    assert np.array_equal(output[:, :313], rgb[:, :313])


def test_rejects_source_phrase_inside_vietnamese():
    item = region(text='Sullivan-sama is being detained at Prison Boros.')
    values, rejected = translator.validate(
        '{"translations":[{"id":"r1","text":"Do vậy, Sullivan-sama is being detained ở Prison Boros."}]}',
        [item], {})
    assert not values and 'r1' in rejected


def test_edge_clipped_balloon_is_one_complete_replacement(monkeypatch):
    from PIL import ImageDraw
    from manga_engine.ocr import Ocr
    from manga_engine.render import font
    page = Image.new('RGB',(320,350),(48,48,48))
    draw = ImageDraw.Draw(page)
    draw.ellipse((-80,42,184,315),fill=(255,255,255),outline=(0,0,0),width=4)
    for i,line in enumerate(['SULLIVAN','IS BEING','DETAINED','IN BOROS.']):
        draw.text((68,120+i*29),line,fill='black',font=font('bold',20),anchor='mm')
    source = np.asarray(page)
    ocr = Ocr()
    # The detector misses the middle two lines and reports two separate boxes.
    monkeypatch.setattr(ocr,'detect',lambda *args:[
        np.array([[16,y-12],[125,y-12],[125,y+12],[16,y+12]],np.int32) for y in (120,207)
    ])
    region, = ocr.regions(source,Settings(language='en'),lambda:None)
    assert 'SULLIVAN IS BEING DETAINED IN BOROS' in region.source
    assert region.balloon_outline
    (x,y,r,b), cleared, _, mask = erase_patch(source,region,False)
    for row in (120,149,178,207):
        ink = source[row-8:row+9,16:125,0] < 145
        assert ink.any()
        assert np.min(cleared[row-8-y:row+9-y,16-x:125-x,0][ink]) > 235
    region.text = 'Sullivan đang bị giam trong nhà tù Boros.'
    output,count = render(source,[region],Settings(language='en'),lambda:None)
    assert count == 1
    assert np.array_equal(source[:,184:],output[:,184:])
    assert np.array_equal(source[:43],output[:43])


def test_invitation_preserves_destination_and_tone():
    item = region(text="LET'S GO HOME.")
    for wording in ('Đi thôi!', 'Hãy về nhà đi.'):
        output, rejected = translator.validate(
            json.dumps({'translations':[{'id':'r1','text':wording}]}),[item],{})
        assert not output and 'r1' in rejected
    output, _ = translator.validate(
        '{"translations":[{"id":"r1","text":"Mình về nhà thôi!"}]}',[item],{})
    assert output == {'r1':'Mình về nhà thôi!'}
