import base64
import json
import sqlite3
import time
from urllib.error import HTTPError

import cv2
import numpy as np
from PIL import Image
import pytest

import manga_engine.engine as pipeline
import manga_engine.translate as translator
from manga_engine.cache import Cache
from manga_engine.contracts import PageInput, Region, Settings
from manga_engine.jobs import Jobs
from manga_engine.ocr import normalize, ordered, tiles
from manga_engine.render import erase_patch, layout, render


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
    assert translator.dialogue_hint(region(text='おはよう、山田先生。', language='ja'), 'Sáng rồi, cô Yamada.')
    sibling = region(text='お姉ちゃん、これ直せる？', language='ja')
    assert translator.dialogue_hint(sibling, 'Em hiểu rồi.')
    assert translator.dialogue_hint(sibling, 'Chị ơi, sửa được cái này không?') is None


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


def test_exact_short_dialogue_needs_no_retry_after_invalid_translation(monkeypatch):
    connector = region('r1', 'BESIDES…')
    sentence = region('r2', 'Besides my friend, nobody saw it.')
    invitation = region('r3', 'LET’S GO HOME.')
    calls = []

    def fake(batch, settings, context, glossary, device, **kwargs):
        calls.append([r.id for r in batch])
        return {'r2': 'Ngoài bạn tôi, chẳng ai nhìn thấy.'}, {'r1': 'Sai từ nối.', 'r3': 'Mất ý lời rủ.'}

    monkeypatch.setattr(translator, 'request_translation', fake)
    translator.translate([connector, sentence, invitation], Settings(), '', {}, lambda: None)
    assert calls == [['r1', 'r2', 'r3']]
    assert connector.text == 'Vả lại…' and sentence.text == 'Ngoài bạn tôi, chẳng ai nhìn thấy.'
    assert invitation.text == 'Về nhà thôi.'
    assert translator.exact_dialogue(connector, {'Besides': 'Ngoài ra'}) is None
    assert translator.exact_dialogue(invitation, {'home': 'nhà mình'}) is None
    assert translator.exact_dialogue(sentence, {}) is None
    assert translator.exact_dialogue(region(text='Besides?'), {}) is None


def test_context_prioritizes_recent_dialogue():
    context = 'First line → Bỏ qua dòng cũ ' * 70 + '\nHaru is here → Haru đã tới.\nStay → Cứ ở lại.'
    assert translator.prompt_context(context, 'balanced') == 'Haru đã tới.\nCứ ở lại.'
    assert translator.prompt_context('Good morning → Chào buổi sáng.', 'quality') == (
        'Good morning → Chào buổi sáng.')
    assert translator.prompt_context('\n', 'balanced') == '\n'


def test_next_dialogue_is_context_only_and_shortening_receives_original_voice(monkeypatch):
    seen = []

    def fake(payload, check):
        seen.append(json.loads(payload['messages'][-1]['content']))
        return json.dumps({key: 'Em hiểu rồi ạ.' for key in payload['format']['required']})

    monkeypatch.setattr(translator, 'chat', fake)
    items = [region(f'r{i}', 'I understand.') for i in range(1, 5)]
    items.append(region('r5', 'Thank you, teacher.'))
    translator.translate(items, Settings(quality='low'), '', {}, lambda: None)
    assert seen[0]['next_dialogue'] == ['Thank you, teacher.']
    assert 'Học trò xưng em' in seen[0]['address_cue']
    assert list(seen[0]['regions']) == ['r1', 'r2', 'r3', 'r4']
    assert list(seen[1]['regions']) == ['r5']
    translator.request_translation(items[:1], Settings(), '', {}, 'cpu', concise=True)
    assert seen[-1]['previous_translation'] == 'Em hiểu rồi ạ.'
    assert translator.dialogue_hint(region(text='The reason I called you here'), 'Sao tôi gọi cậu?')
    assert translator.exact_dialogue(region(text='The reason I called you here'), {}) == 'Lý do tôi gọi cậu đến đây'
    assert translator.dialogue_hint(region(text='Good morning!'), 'Sáng rồi!')
    assert translator.exact_dialogue(region(text='Good morning!'), {}) == 'Chào buổi sáng!'
    assert translator.dialogue_hint(region(text='The reason I called you here was to ask.'), '') is None


def test_failed_dialogue_is_retried_with_source_context(monkeypatch):
    contexts = []

    def fake(payload, check):
        context = json.loads(payload['messages'][-1]['content'])['chapter_context']
        contexts.append(context)
        return json.dumps({'r1': 'Chào buổi sáng!' if 'Haru is here' in context else 'Xin chào!'})

    monkeypatch.setattr(translator, 'chat', fake)
    item = region(text='Good morning, Haru!')
    translator.translate([item], Settings(), 'Haru is here → Haru đã tới.', {}, lambda: None)
    assert len(contexts) == 2 and 'Haru is here' not in contexts[0]
    assert 'Haru is here → Haru đã tới.' in contexts[1]
    assert item.text == 'Chào buổi sáng!'


def test_polishing_keeps_guarded_dialogue_and_accepts_a_natural_rewrite(monkeypatch):
    cases = [
        ('Could you give me a hand?', 'Cậu có thể giúp tớ một chút được không?', 'Cậu giúp tớ một tay nhé?'),
        ('I understand.', 'Tôi đã sửa tay.', 'Tớ hiểu rồi.'),
        ('Come back in 3 days.', 'Quay lại sau 3 ngày nhé.', '5 ngày nữa quay lại nhé.'),
        ("I won't come back.", 'Tớ sẽ không quay lại.', 'Tớ sẽ quay lại.'),
        ('Meet me at the East Gate.', 'Gặp tớ ở Cổng Đông.', 'Ra cổng thành gặp tớ nhé.'),
        ('Good morning!', 'Chào buổi sáng!', 'Xin chào!'),
        ('Come back tomorrow.', 'Mai quay lại nhé.', 'Hôm nay quay lại nhé.'),
    ]
    items = []
    for offset, (source, draft, _) in enumerate(cases, 1):
        item = region(f'r{offset}', source)
        item.text = draft
        items.append(item)
    candidates = {item.id: case[2] for item, case in zip(items, cases)}
    seen = []

    def fake(batch, scene, settings, context, glossary, device, check):
        seen.extend(item.id for item in batch)
        output = [{'id': item.id, 'text': candidates[item.id]} for item in batch]
        accepted, _ = translator.validate(json.dumps({'translations': output}), batch, glossary)
        return accepted

    monkeypatch.setattr(translator, 'request_polish', fake)
    translator.polish_dialogue(items, Settings(quality='quality'), '', {'East Gate': 'Cổng Đông'},
                               'cpu', lambda: None, protected={'r2'})
    assert sorted(seen) == ['r1', 'r3', 'r4', 'r5', 'r6', 'r7']
    assert [item.text for item in items] == [cases[0][2], *(case[1] for case in cases[1:])]
    assert not any(item.issue for item in items)


@pytest.mark.parametrize('quality, expected_calls', [('quality', 1), ('low', 0)])
def test_polishing_failure_or_low_memory_mode_keeps_first_draft(monkeypatch, quality, expected_calls):
    item = region(text='Could you give me a hand?')
    item.text = 'Cậu có thể giúp tớ một chút được không?'
    calls = []

    def fail(*args, **kwargs):
        calls.append(1)
        raise OSError('Ollama tạm thời chưa phản hồi')

    monkeypatch.setattr(translator, 'request_polish', fail)
    translator.polish_dialogue([item], Settings(quality=quality), '', {}, 'cpu', lambda: None)
    assert len(calls) == expected_calls
    assert item.text == 'Cậu có thể giúp tớ một chút được không?' and not item.issue


def test_balanced_polishing_targets_stilted_lines(monkeypatch):
    homework = region('r1', 'Hand in your homework tomorrow.')
    homework.text = 'Em gửi bài tập vào ngày mai nhé.'
    ordinary = region('r2', 'All right.')
    ordinary.text = 'Dạ, em biết rồi.'
    invitation = region('r3', "Let's go home.")
    invitation.text = 'Chúng ta đi về nhà đi.'
    friend = region('r4', "Come on, you're my best friend.")
    friend.text = 'Mày là bạn thân của tớ mà.'
    seen = []

    def polish(batch, scene, settings, context, glossary, device, check):
        seen.append([item.id for item in batch])
        assert ordinary in scene
        return {'r1': 'Mai nộp bài nhé.'}

    monkeypatch.setattr(translator, 'request_polish', polish)
    translator.polish_dialogue([homework, ordinary, invitation, friend], Settings(), '', {}, 'cpu', lambda: None)
    assert seen == [['r1']]
    assert [homework.text, ordinary.text, invitation.text] == [
        'Mai nộp bài nhé.', 'Dạ, em biết rồi.', 'Về nhà thôi.',
    ]
    assert friend.text == 'Cậu là bạn thân của tớ mà.'


def test_batch_size_respects_text_length():
    items = [region(f'r{i}', 'a'*460) for i in range(1,6)]
    assert [len(batch) for batch in translator.batches(items,'balanced')] == [2,2,1]
    assert [len(batch) for batch in translator.batches(items,'low')] == [1,1,1,1,1]
    short = [region(f'r{i}', 'Thank you!') for i in range(1,11)]
    assert [len(batch) for batch in translator.batches(short[:9],'balanced')] == [9]
    assert [len(batch) for batch in translator.batches(short,'balanced')] == [7,3]
    for item in short[:8]:
        item.source = 'A'*145
    assert [len(batch) for batch in translator.batches(short[:8],'balanced')] == [7,1]


def test_font_change_reuses_unedited_translation_after_reopen(tmp_path, monkeypatch):
    path = tmp_path/'pages.sqlite3'
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE pages (key TEXT PRIMARY KEY, original BLOB NOT NULL, output BLOB NOT NULL,"
                   "metadata TEXT NOT NULL, size INTEGER NOT NULL, at REAL NOT NULL)")
        db.execute("INSERT INTO pages VALUES ('old', x'61', x'62', '{}', 4, 0)")
    engine = pipeline.Engine(Cache(path, 1_000_000))
    assert engine.cache.page('old')[0] == b'b'
    raw = pipeline.png(np.full((80,80,3),255,dtype=np.uint8), None)
    page = PageInput(image=base64.b64encode(raw).decode(), settings=Settings(), context='Cảnh đầu')
    calls = []
    protected_ids = []
    layout_fallbacks = []
    monkeypatch.setattr(pipeline, 'installed', lambda model: {'digest':model})
    def read(self, *args):
        calls.append('ocr')
        return [region()]
    def translate(regions, *args):
        calls.append('translate')
        regions[0].text = 'Chào buổi sáng!'
        return 'cpu'
    def polish(regions, *args, protected):
        protected_ids.append(list(protected))
        if 'r1' not in protected:
            regions[0].text = 'Em chào buổi sáng!'
    def render_page(rgb, *args, original_texts=None):
        layout_fallbacks.append(original_texts)
        return rgb, 1
    monkeypatch.setattr(pipeline.Ocr, 'regions', read)
    monkeypatch.setattr(pipeline, 'translate', translate)
    monkeypatch.setattr(pipeline, 'polish_dialogue', polish)
    monkeypatch.setattr(pipeline, 'render', render_page)
    def process(engine, page):
        key = engine.process(page, lambda:None, lambda _:None)['key']
        return key, engine.cache.page(key)[1]
    key, first = process(engine, page)
    engine.cache.put(key, raw, raw, first, {'r1': {'id':'r1', 'text':'Lời sửa tay'}})

    reopened = pipeline.Engine(Cache(path, 1_000_000))
    styled = page.model_copy(update={'settings': Settings(font='bold')})
    _, persisted = process(reopened, styled)
    assert calls == ['ocr','translate']
    assert protected_ids == [[]]
    assert layout_fallbacks == [{'r1': 'Chào buổi sáng!'}]*2
    assert persisted['regions'][0]['text'] == 'Em chào buổi sáng!'
    assert persisted['settings']['font'] == 'bold'
    process(reopened, styled.model_copy(update={'force': True}))
    changed_context = page.model_copy(update={'settings': Settings(font='italic'), 'context':'Cảnh khác'})
    process(reopened, changed_context)
    assert calls == ['ocr','translate']*3
    _, forced = process(reopened, page.model_copy(update={'force': True}))
    assert protected_ids == [[], [], [], ['r1']]
    assert layout_fallbacks[-1] is None
    assert forced['regions'][0]['text'] == 'Lời sửa tay'


def test_low_memory_unloads_once_after_layout(tmp_path, monkeypatch):
    engine = pipeline.Engine(Cache(tmp_path/'pages.sqlite3', 1_000_000))
    raw = pipeline.png(np.full((80,80,3),255,dtype=np.uint8), None)
    page = PageInput(image=base64.b64encode(raw).decode(), settings=Settings(quality='low'))
    calls = []
    monkeypatch.setattr(pipeline, 'installed', lambda model: {'digest':model})
    monkeypatch.setattr(pipeline.Ocr, 'regions', lambda *args: [region()])
    monkeypatch.setattr(pipeline, 'unload', lambda model: calls.append('unload'))

    def translate(regions, *args):
        calls.append('translate')
        regions[0].text = 'Chào buổi sáng!'
        return 'cpu'

    def request(*args):
        calls.append('shorten')
        return {'r1': 'Chào buổi sáng!'}, {}

    def render(rgb, regions, settings, check, shorten):
        assert shorten(regions[0])
        return rgb, 1

    monkeypatch.setattr(pipeline, 'translate', translate)
    monkeypatch.setattr(pipeline, 'request_translation', request)
    monkeypatch.setattr(pipeline, 'render', render)
    result = engine.process(page, lambda: None, lambda _: None)
    assert not result['cached'] and calls == ['translate', 'shorten', 'unload']
    assert engine.process(page, lambda: None, lambda _: None)['cached']
    assert calls == ['translate', 'shorten', 'unload']


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


def test_polished_line_that_does_not_fit_uses_original_draft_before_shortening():
    img, draft = example_patch()
    expected, count = render(img, [draft], Settings(), lambda: None)
    assert count == 1

    polished = draft.model_copy(update={'text': 'x'*450})

    def shorten(region):
        pytest.fail('The draft already fits, so shortening is unnecessary.')

    actual, count = render(img, [polished], Settings(), lambda: None, shorten,
                           original_texts={draft.id: draft.text})
    assert count == 1 and not polished.issue
    assert polished.text == draft.text
    assert polished.box == draft.box and polished.bubble == draft.bubble
    assert np.array_equal(actual, expected)


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
    regions = ocr.regions(rgb, Settings(language='en'), lambda: None)
    item = next(region for region in regions if region.source == 'GOOD MORNING!')
    assert 'THANK YOU!' in {region.source for region in regions}
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


def test_large_strip_balloon_recovered_when_detector_misses_every_line(monkeypatch):
    from PIL import ImageDraw
    from manga_engine.ocr import Ocr
    from manga_engine.render import font
    page = Image.new('RGB',(540,480),(35,35,35))
    draw = ImageDraw.Draw(page)
    draw.ellipse((-55,-100,248,576),fill='white',outline='black',width=4)
    lines = ['THUS, WE','HAVE MADE','THE PROMPT','DECISION TO','ORGANIZE A','PROVISIONAL','13 CROWNS.']
    for i,line in enumerate(lines):
        draw.text((117,144+i*27),line,fill='black',font=font('bold',20),anchor='mm')
    draw.ellipse((314,80,517,250),fill='white',outline='black',width=4)
    draw.text((415,160),'THANK YOU!',fill='black',font=font('bold',20),anchor='mm')
    original = np.asarray(page)
    ocr = Ocr()
    monkeypatch.setattr(ocr,'detect',lambda *args:[
        np.array([[344,146],[492,146],[492,175],[344,175]],np.int32)
    ])
    regions = ocr.regions(original,Settings(language='en'),lambda:None)
    assert len(regions) == 2
    left,right = sorted(regions,key=lambda r:r.box[0])
    assert left.source == ' '.join(lines) and right.source == 'THANK YOU!'
    assert not left.polygons and left.balloon_outline and not left.issue
    (x,y,r,b), cleared, _, _ = erase_patch(original,left,False)
    ink = original[131:321,25:220,0] < 180
    assert np.min(cleared[131-y:321-y,25-x:220-x,0][ink]) > 235
    left.text = 'Vì vậy, chúng tôi quyết định sớm lập Hội đồng 13 Vương miện lâm thời.'
    right.text = 'Xin cảm ơn!'
    output,count = render(original,regions,Settings(language='en'),lambda:None)
    assert count == 2
    assert np.array_equal(original[:,253:311],output[:,253:311])


def test_validation_rejects_number_taken_from_neighboring_balloon():
    items = [region('r1','We decided to appoint 13 crowns.'),region('r2','Thank you for coming.')]
    data = '{"translations":[{"id":"r1","text":"Chúng tôi quyết định bổ nhiệm 13 vị."},{"id":"r2","text":"Chúng tôi bổ nhiệm 13 vị."}]}'
    accepted,rejected = translator.validate(data,items,{})
    assert set(accepted) == {'r1'} and set(rejected) == {'r2'}


def test_rescans_leaking_balloon_and_repairs_wrapped_words(monkeypatch):
    from PIL import ImageDraw
    from manga_engine.ocr import Ocr, join_english_lines
    from manga_engine.render import font

    page = Image.new('RGB', (400,340), 'white')
    draw = ImageDraw.Draw(page)
    draw.ellipse((54,28,295,318), outline='black', width=3)
    # Simulate a small gap where the outline crosses a bright panel boundary.
    draw.rectangle((47,171,61,173), fill='white')
    for i,line in enumerate(('TO INVESTI-', 'GATE THE', 'RELATION-', 'SHIP')):
        draw.text((168,120+i*27),line,fill='black',font=font('bold',20),anchor='mm')
    original = np.asarray(page)
    engine = Ocr()
    monkeypatch.setattr(engine,'detect',lambda *args:[
        np.array([[92,y-12],[249,y-12],[249,y+12],[92,y+12]],np.int32) for y in (120,147,174,201)
    ])
    item, = engine.regions(original, Settings(language='en'), lambda:None)
    assert item.balloon_outline and not item.issue
    assert item.source == 'TO INVESTIGATE THE RELATIONSHIP'
    item.text = 'Để điều tra mối quan hệ'
    output, count = render(original, [item], Settings(language='en'), lambda:None)
    assert count == 1
    assert np.array_equal(original[:, :50], output[:, :50])
    assert join_english_lines(['SULLIVAN-', 'SAMA']) == 'SULLIVAN-SAMA'


def test_joined_spiky_balloon_keeps_three_dialogue_blocks(monkeypatch):
    from PIL import ImageDraw
    from manga_engine.ocr import Ocr
    from manga_engine.render import font

    canvas = Image.new('RGB', (925,500), (44,44,44))
    draw = ImageDraw.Draw(canvas)
    centers = [(155,195),(423,227),(698,166)]
    for x,y in centers:
        points = []
        for index in range(48):
            angle = index*2*np.pi/48
            spike = 1 if index%2 == 0 else .82
            points.append((round(x+154*spike*np.cos(angle)),round(y+125*spike*np.sin(angle))))
        draw.polygon(points,fill='white')
    draw.polygon([(200,181),(654,142),(650,198),(204,216)], fill='white')
    artwork = np.asarray(canvas).copy()

    evidence = []
    blocks = [
        ("SULLIVAN-", "SAMA NEEDS", "HELP."),
        ("IF I LOSE MY", "AUTHORITY,", "I'LL BE WEAKER."),
        ("WE'RE ALSO", "QUESTION-", "ING THE CROWNS."),
    ]
    style = font('italic',22)
    for (x,y), lines in zip(centers,blocks):
        for index,line in enumerate(lines):
            position = (x,y-27+27*index)
            l,t,r,b = draw.textbbox(position,line,font=style,anchor='mm')
            evidence.append(np.array([(l-3,t-2),(r+3,t-2),(r+3,b+2),(l-3,b+2)], dtype=np.int32))
            draw.text(position,line,fill='black',font=style,anchor='mm')
    original = np.asarray(canvas)
    ocr = Ocr()
    monkeypatch.setattr(ocr,'detect',lambda *args: list(reversed(evidence)))
    regions = sorted(ocr.regions(original,Settings(language='en'),lambda:None),key=lambda r:r.box[0])
    assert len(regions) == 3
    assert [r.source for r in regions] == [
        "SULLIVAN-SAMA NEEDS HELP.",
        "IF I LOSE MY AUTHORITY, I'LL BE WEAKER.",
        "WE'RE ALSO QUESTIONING THE CROWNS.",
    ]
    for region, text in zip(regions, [
            'Ngài Sullivan cần được giúp đỡ.', 'Nếu mất quyền hạn, tôi sẽ càng yếu thế.',
            'Chúng tôi cũng đang thẩm vấn các vị Vương Miện.']):
        assert region.balloon_outline and not region.issue
        region.text = text
    shifted, rendered = render(original,regions,Settings(language='en',font_scale=1.2),lambda:None)
    assert rendered == 3
    outside = artwork[:,:,0] == 44
    assert np.array_equal(shifted[outside],original[outside])


def test_source_wrap_preserves_honorifics_and_true_hyphens():
    from manga_engine.ocr import join_english_lines, repair_letter_confusions

    assert join_english_lines(["WE'RE QUESTION –", "ING THE CROWNS."]) == "WE'RE QUESTIONING THE CROWNS."
    assert join_english_lines(["WE'RE QUESTION", "ING THE CROWNS."]) == "WE'RE QUESTIONING THE CROWNS."
    assert join_english_lines(["SULLIVAN ‑", "SAMA NEEDS HELP."]) == "SULLIVAN-SAMA NEEDS HELP."
    assert join_english_lines(["THE NEXT-IN-", "COMMAND WILL EX-", "PLAIN."]) == "THE NEXT-IN-COMMAND WILL EXPLAIN."
    assert join_english_lines(["THERE ARE", "TWO SHIPS."]) == "THERE ARE TWO SHIPS."
    assert repair_letter_confusions("T'LL BE MORE POWERLESS 10 HELP.") == "I'LL BE MORE POWERLESS TO HELP."
    assert repair_letter_confusions("THE 13 CROWNS NEED 10 PEOPLE.") == "THE 13 CROWNS NEED 10 PEOPLE."
    assert repair_letter_confusions("WAS MADE BY BAAL AND 1.") == "WAS MADE BY BAAL AND I."


def test_translation_retains_meaning_in_adjacent_clauses():
    items = [region('r1','Besides...'),
             region('r2','Sullivan-sama needs folks on his side.'),
             region('r3',"I'll be even more powerless to help him than I am now."),
             region('r4',"It'd make it look like it's a crime just to associate with him!")]
    wrong = {"translations": [
        {'id':'r1','text':'Mà chỉ thế thôi!'},
        {'id':'r2','text':'Sullivan-sama sẽ chẳng còn ai đứng về phía mình.'},
        {'id':'r3','text':'Tôi sẽ càng bất lực hơn bây giờ.'},
        {'id':'r4','text':'Trông như một tội phạm vì liên quan đến anh ấy!'},
    ]}
    accepted, rejected = translator.validate(json.dumps(wrong), items, {})
    assert not accepted and set(rejected) == {'r1','r2','r3','r4'}
    correct = {"translations": [
        {'id':'r1','text':'Hơn nữa…'},
        {'id':'r2','text':'Ngài Sullivan cần người đứng về phía mình.'},
        {'id':'r3','text':'Tôi sẽ càng bất lực hơn khi muốn giúp anh ấy.'},
        {'id':'r4','text':'Cứ như thể chỉ cần qua lại với anh ấy là phạm tội vậy!'},
    ]}
    accepted, rejected = translator.validate(json.dumps(correct), items, {})
    assert set(accepted) == {'r1','r2','r3','r4'} and not rejected
    assert translator.dialogue_hint(region(text='No one needs help.'), 'Không ai cần giúp.') is None
