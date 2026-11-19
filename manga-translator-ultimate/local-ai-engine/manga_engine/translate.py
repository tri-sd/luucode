import json
import os
import time
import re
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, HTTPRedirectHandler, Request, build_opener

from pydantic import ValidationError

from .contracts import Translations
from .ocr import JP

BASE = "http://127.0.0.1:11434"
SAFE_MODEL = re.compile(r"^[\w.-]{1,80}(?::[\w.-]{1,80})?$")
VI = re.compile("[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]", re.I)
TIME_IN_GREETING = [
    (re.compile(r"\bgood morning\b|おはよう|お早う", re.I), re.compile(r"\bsáng\b", re.I), "Preserve the morning greeting with the Vietnamese word sáng."),
    (re.compile(r"\bgood evening\b|こんばんは|こんばんわ|今晩は", re.I), re.compile(r"\btối\b", re.I), "Preserve the evening greeting with the Vietnamese word tối."),
    (re.compile(r"\bgood\s?night\b|おやすみ", re.I), re.compile(r"\b(tối|đêm|ngủ)\b", re.I), "Preserve the bedtime reference with ngủ, đêm, or tối."),
]
EN = re.compile(r"\b(the|this|there|what|you|your|hello|good|morning|with|would|are|is|am|and|let's|have|please)\b", re.I)
ADDITIVE_CONNECTORS = {"besides": "Vả lại", "furthermore": "Hơn nữa",
                       "moreover": "Hơn nữa", "in addition": "Ngoài ra"}
MORNING_GREETINGS = {"good morning", "おはよう", "お早う"}
EXACT_DIALOGUE = {**ADDITIVE_CONNECTORS, **dict.fromkeys(MORNING_GREETINGS, "Chào buổi sáng"),
                  "let's go home": "Về nhà thôi", "let's head home": "Về nhà thôi",
                  "the reason i called you here": "Lý do tôi gọi cậu đến đây"}
FRIENDLY_REASSURANCE = re.compile(r"come on,\s*you(?:'re| are) my (?:best|closest) friend\b")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise URLError("Loopback redirects are disabled")


OPENER = build_opener(ProxyHandler({}), NoRedirect())


def local(path, payload=None, timeout=3):
    data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    request = Request(BASE + path, data=data, headers={"Content-Type": "application/json"} if data else {})
    with OPENER.open(request, timeout=timeout) as response:
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError("Phản hồi Ollama quá lớn.")
        return json.loads(raw)


def chat(payload, check):
    request = Request(BASE + "/api/chat", data=json.dumps(payload, ensure_ascii=False).encode(),
                      headers={"Content-Type": "application/json"})
    parts, length = [], 0
    deadline = time.monotonic()+115
    with OPENER.open(request, timeout=55) as response:
        while line := response.readline(48_000):
            check()
            row = json.loads(line)
            if row.get("error"):
                raise RuntimeError("Ollama báo lỗi suy luận local.")
            chunk = row.get("message", {}).get("content", "")
            parts.append(chunk)
            length += len(chunk)
            if length > 12_000 or time.monotonic() >= deadline:
                raise ValueError("Phản hồi Ollama vượt giới hạn.")
            if row.get("done"):
                return "".join(parts)
    raise ValueError("Phản hồi Ollama bị ngắt.")


def models():
    return [x for x in local("/api/tags").get("models", [])
            if SAFE_MODEL.fullmatch(x.get("name", "")) and not x.get("remote_host")
            and not x["name"].endswith("-cloud") and ":cloud" not in x["name"]
            and re.fullmatch(r"[a-f0-9]{64}", x.get("digest", "")) and x.get("size", 0) > 10_000_000]


def installed(name):
    candidates = models()
    found = next((m for m in candidates if m["name"] == name or m["name"] == name + ":latest"), None)
    if found is None:
        raise ValueError(f"Chưa tải mô hình Ollama local {name}.")
    info = local("/api/show", {"model": found["name"]})
    if info.get("remote_host") or info.get("remote_model") or "cloud" in info.get("capabilities", []):
        raise ValueError("Chỉ mô hình có trọng số local mới được sử dụng.")
    return found


def unload(name):
    try:
        local("/api/chat", {"model": name, "messages": [], "keep_alive": 0}, timeout=2)
    except (OSError, ValueError):
        # Ollama's short idle timeout releases the model if the call fails.
        pass


def folded(text):
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split()).strip(".!?。！？")


def glossary_matches(text, key):
    term = folded(key)
    return bool(term and (term in text if JP.search(key) else
                          re.search(r"(?<!\w)" + re.escape(term) + r"(?!\w)", text)))


def exact_dialogue(region, glossary):
    if region.language not in {"en", "ja"}:
        return None
    source = " ".join(unicodedata.normalize("NFKC", region.source).casefold().replace("’", "'").split())
    match = re.fullmatch(r"(.+?)(\.{3}|[.,!。])?", source)
    if not match or match[1] not in EXACT_DIALOGUE or any(
            glossary_matches(match[1], key) for key in glossary):
        return None
    suffix = {"...": "…", "。": "."}.get(match[2], match[2] or "")
    return EXACT_DIALOGUE[match[1]] + suffix


def copied_english(source, translation):
    if source.language != "en":
        return False
    words = re.findall(r"[a-z]+(?:'[a-z]+)?", folded(source.source))
    output = " " + " ".join(re.findall(r"[^\W\d_]+(?:'[^\W\d_]+)?", folded(translation))) + " "
    return any(f" {' '.join(words[i:i+3])} " in output and EN.search(" ".join(words[i:i+3]))
               for i in range(len(words)-2))


def dialogue_hint(source, text):
    phrase = folded(source.source)
    if (re.match(r"(?:good morning|おはよう(?:ございます)?|お早う)(?:[\s,.!?、。！？]|$)", phrase)
            and not re.search(r"\bchào\b|tốt lành|vui vẻ", text, re.I)):
        return "Giữ lời chào buổi sáng."
    if source.language == "ja":
        if re.match(r"お?姉(?:ちゃん|さん|さま)[、,]", source.source) and not re.search(r"\bchị\b", text, re.I):
            return "Đây là lời gọi chị gái. Giữ cách gọi «chị»."
        if re.search(r"[?？][!！]?$", source.source) and (not text or not re.search(r"\?[!]?$", text)):
            return "Giữ dạng câu hỏi ở cuối lời thoại."
    if source.language != "en":
        return None
    if phrase == "the reason i called you here" and "?" not in source.source and (not text or text.endswith("?")):
        return "Đây là vế mở đầu câu kể. Giữ vế nối sang ô sau và giữ giọng trung tính."
    if phrase in ADDITIVE_CONNECTORS and not re.search(
            r"hơn nữa|ngoài ra|vả lại|thêm nữa|với lại|huống chi|chưa kể|bên cạnh đó|hơn thế nữa",text,re.I):
        return "Giữ chức năng nối ý bổ sung của ô này, như «Hơn nữa…» hoặc «Vả lại…»."
    if (re.fullmatch(r"[\w -]+ needs? (folks|people|someone|allies|support|help)( on (his|her|their) side)?",phrase)
            and not re.search(r"\b(no|not|never|barely|hardly)\b",phrase)
            and not re.search(r"cần|phải có|phải được|phải tìm|thiếu",text,re.I)):
        return "Giữ nghĩa chủ thể cần người hỗ trợ, đừng suy diễn rằng họ đã mất người hỗ trợ."
    if re.search(r"\b(?:to|can|could) help (him|her|them)\b",phrase) and not re.search(
            r"giúp|hỗ trợ|đỡ đần|cứu|ra tay",text,re.I):
        return "Giữ hành động giúp đỡ được nói đến trong câu."
    if re.search(r"\ba crime (?:just )?to\b",phrase) and not re.search(
            r"phạm tội|phạm pháp|là (?:một )?tội\b(?!\s+phạm)|tội danh|có tội|trái luật|phạm luật|vi phạm pháp luật",text,re.I):
        return "Nói hành động bị coi là phạm tội. Dùng mẫu «Chỉ việc … cũng bị coi là phạm tội» khi phù hợp."
    return None


def validate(content, batch, glossary):
    values = Translations.model_validate_json(content).translations
    inputs = {r.id: r for r in batch}
    ids = [r.id for r in values]
    if len(set(ids)) != len(ids) or set(ids) - inputs.keys():
        raise ValueError("Region ID bị trùng hoặc ngoài danh sách")
    numbers = re.compile(r"(?<!\w)\d+(?!\w)")
    source_numbers = {r.id:set(numbers.findall(r.source)) for r in batch}
    batch_numbers = set().union(*source_numbers.values())
    output, rejected = {}, {}
    for item in values:
        source = inputs[item.id]
        text = " ".join(unicodedata.normalize("NFC", item.text).split())
        original = folded(source.source)
        expected = [term for key, term in glossary.items() if glossary_matches(original, key)]
        meaning_hint = dialogue_hint(source,text)
        missed_greeting = next((hint for marker, target, hint in TIME_IN_GREETING
                                if marker.search(source.source) and not target.search(text)), None)
        if not text or not re.search(r"[A-Za-zÀ-ỹ]", text) or JP.search(text):
            rejected[item.id] = "Bản dịch thiếu tiếng Việt."
        elif copied_english(source, text) or (folded(text) == folded(source.source) and EN.search(text) and not expected) or (
                not VI.search(text) and len(EN.findall(text)) >= 2):
            rejected[item.id] = "Bản dịch có dấu hiệu còn tiếng Anh."
        elif source.language == "en" and re.match(r"[\s\"“]*(let's|let’s|let us)\b", source.source, re.I) and re.match(r"hãy\b", text, re.I):
            rejected[item.id] = "Dịch lời rủ rê, dùng cách nói như «Đi thôi» hoặc «Mình đi nhé»."
        elif source.language == "en" and re.search(r"\b(go|head|return|come|walk) (back )?home\b", source.source, re.I) and not re.search(r"\bvề\b|\bnhà\b", text, re.I):
            rejected[item.id] = "Giữ ý trở về nhà trong câu."
        elif set(numbers.findall(text)) & (batch_numbers-source_numbers[item.id]):
            rejected[item.id] = "Kiểm tra đúng ô thoại. Bản dịch chứa con số xuất hiện ở ô nguồn khác."
        elif missed_greeting:
            rejected[item.id] = missed_greeting
        elif meaning_hint:
            rejected[item.id] = meaning_hint
        elif any(folded(term) not in folded(text) for term in expected):
            rejected[item.id] = "Bản dịch thiếu thuật ngữ trong từ điển."
        elif re.search(r"(\S{2,})(?:\s+\1){3,}", text, re.I) or (
                len(text.split()) >= 4 and not re.search(r"\b(\w+)\s+\1\b", source.source, re.I)
                and re.search(r"\b(?!rất\b|thật\b)([\w]{3,})\s+\1\b", text, re.I)):
            rejected[item.id] = "Bản dịch lặp bất thường."
        else:
            output[item.id] = text
    for region in batch:
        if region.id not in output:
            continue
        text = folded(output[region.id])
        if any(other.id != region.id and other.language == "en" and EN.search(other.source)
               and text == folded(other.source) != folded(region.source) for other in batch):
            output.pop(region.id)
            rejected[region.id] = "Bản dịch có dấu hiệu lẫn lời thoại."
    return output, rejected


def prompt_context(context, quality):
    if quality != "quality" and " → " in context:
        # Reader context has one source → Vietnamese pair per line.
        # Its Vietnamese half already carries the names and voice of the scene.
        context = "\n".join(line.split(" → ", 1)[-1] for line in context.splitlines())
    limit = {"low": 380, "balanced": 620, "quality": 1600}[quality]
    excerpt = context[-limit:]
    if len(context) > limit:
        _, separator, complete = excerpt.partition("\n")
        if separator and complete:
            excerpt = complete
    return excerpt


def request_translation(batch, settings, context, glossary, device, concise=False, check=lambda: None,
                        notes=None, *, full_context=False, following=()):
    def speech(region):
        text = region.source
        # All-caps English is a lettering convention on many pages.
        return text.capitalize() if region.language == "en" and text.isupper() and len(text.split()) > 1 else text

    prompt = {
        "chapter_context": prompt_context(context, "quality" if full_context else settings.quality),
        "glossary": glossary,
        "regions": {r.id: speech(r) for r in batch},
    }
    if following:
        prompt["next_dialogue"] = [speech(region)[:120] for region in following]
    sources = "\n".join(region.source for region in (*batch, *following))
    if (re.search(r",\s*(?:teacher|professor)[.!?]?(?:\n|$)", sources, re.I)
            or ("先生" in sources and re.search(r"宿題|授業|教室", sources))):
        prompt["address_cue"] = ("Chỉ áp dụng ở lượt thầy/cô và học trò nói với nhau. "
                                 "Học trò xưng em khi cần đại từ. Xét ai đang nói ở từng lượt.")
    elif re.search(r"\bmy (?:best|childhood|closest) friend\b", sources, re.I):
        prompt["address_cue"] = "Khi hai bạn thân nói trực tiếp với nhau, có thể xưng mình–cậu hoặc tớ–cậu."
    hints = {r.id: hint for r in batch if (hint := dialogue_hint(r,""))}
    hints.update(notes or {})
    if hints:
        prompt["validation_notes"] = hints
    system = ("Dịch lời thoại manga Anh/Nhật sang tiếng Việt như lời nói thật, có dấu và vừa ô. "
              "Hiểu cả lượt đối đáp. Dựa vào vai vế, độ thân quen và thái độ để xưng hô. "
              "Giữ đúng cặp xưng hô giữa hai người. Đổi vai khi tới lời đáp. "
              "Khi chưa rõ quan hệ, lược đại từ nếu tự nhiên. Từ ngữ thô chỉ dùng khi giọng gốc thô. "
              "Dùng từ đời thường. Giữ câu bắt đầu ở ô này và kết thúc ở ô sau liền mạch. "
              "Giữ tên, chức danh và từ điển. Giữ ý và sắc thái, câu rủ, đích đến và thời điểm lời chào. "
              "Mỗi ID chỉ dịch lời của ô đó. Ngữ cảnh và next_dialogue chỉ để hiểu cảnh. Dùng validation_notes để sửa lỗi. "
              "Trả JSON với ID của ô làm khóa và lời dịch làm giá trị.")
    if concise:
        system += " Rút gọn lời thoại, giữ ý chính và cách xưng hô ở bản đã dịch."
        if batch[0].text:
            prompt["previous_translation"] = batch[0].text
    return request_regions(batch, system, prompt, settings, glossary, device, check)


def request_regions(batch, system, prompt, settings, glossary, device, check):
    threads = min(4, max(2, (len(os.sched_getaffinity(0))-1) if hasattr(os, "sched_getaffinity") else 4))
    options = {"num_ctx": 4096, "num_predict": min(900, 90 + 66*len(batch)), "temperature": 0,
               "num_thread": min(threads, 2) if settings.quality == "low" else threads}
    schema = {"type": "object", "properties": {r.id: {"type": "string"} for r in batch},
              "required": [r.id for r in batch], "additionalProperties": False}
    if device == "cpu":
        options["num_gpu"] = 0
    text = chat({
        "model": settings.model, "stream": True,
        "keep_alive": "45s" if settings.quality == "low" else "3m",
        "format": schema, "options": options,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": json.dumps(prompt, ensure_ascii=False, separators=(",", ":"))}],
    }, check)
    keyed = json.loads(text, object_pairs_hook=list)
    if not isinstance(keyed, list) or not all(isinstance(pair, tuple) and len(pair) == 2 for pair in keyed):
        raise ValueError("Phản hồi dịch phải là đối tượng theo ID.")
    return validate(json.dumps({"translations": [{"id":key,"text":value} for key,value in keyed]}), batch, glossary)


def editorial_note(region, draft):
    if region.language != "en":
        return None
    source, text = folded(region.source), folded(draft)
    if re.search(r"\bpowerless to help\b", source) and re.search(r"\byếu (?:đuối|hơn)\b", text):
        return "Đây là khả năng giúp đỡ bị hạn chế. Dùng «khó giúp» hoặc «bất lực», giữ ý so sánh nếu có."
    if re.search(r"\b(?:hand|turn) in\b", source) and "homework" in source and re.search(r"\b(?:gửi|giao)\b", text):
        return "Dùng cách nói «nộp bài». Giữ hạn nộp và giọng nhắc nhở của người nói."
    if source.startswith("was made by ") and text.startswith("đã được ") and text.endswith(" quyết định"):
        return "Đây là vế sau của câu. Dùng «do … đưa ra», giữ nguyên tên và người tham gia."
    if FRIENDLY_REASSURANCE.match(source):
        if text.startswith("đi thôi"):
            return "Đây là lời dỗ bạn mở lòng. Dịch «Thôi nào», giữ ý đang khuyên bạn chia sẻ."
        if re.search(r"\btớ\b", text) and re.search(r"\bmày\b", text):
            return "Giữ cặp xưng hô tớ–cậu trong lời dỗ bạn."
    return None


def request_polish(batch, scene, settings, context, glossary, device, check):
    editable = {region.id for region in batch}
    prompt = {
        "chapter_context": prompt_context(context, settings.quality)[-460:],
        "glossary": glossary,
        "dialogue": [{"id": region.id, "source": region.source, "draft": region.text,
                      "note": editorial_note(region, region.text)} if region.id in editable else
                     {"draft": region.text} for region in scene],
        "edit_ids": [region.id for region in batch],
    }
    system = ("Biên tập thoại truyện tranh tiếng Việt. Đọc nguyên văn, bản nháp và các lượt đáp. "
              "Viết lại các câu dịch sát chữ theo nhịp nói thật. Ví dụ «Cậu có thể vui lòng đưa nó cho tôi được không?» "
              "thành «Cậu đưa giúp tôi cái đó được không?». Ưu tiên xử lý note nếu có. "
              "Giữ hơi nói riêng của nhân vật, mức lịch sự, ý phủ định, thời gian, tên và số. "
              "Khi chưa rõ vai, giữ cách gọi có căn cứ hoặc lược đại từ. Giữ vế nối qua ô đúng vị trí. "
              "Chỉ trả JSON với ID làm khóa và lời thoại đã biên tập làm giá trị.")
    values, _ = request_regions(batch, system, prompt, settings, glossary, device, check)
    return values


NUMBER = re.compile(r"(?<!\w)\d+(?:[.,]\d+)*(?!\w)")
NEGATION = re.compile(r"\b(?:không|chưa|chẳng|đừng|chớ)\b", re.I)
DAY_REFERENCES = [
    (r"\byesterday\b|昨日", r"\bhôm qua\b"),
    (r"\btoday\b|今日", r"\bhôm nay\b"),
    (r"\btomorrow\b|明日", r"\bmai\b"),
]


def keeps_dialogue_facts(region, text):
    draft = region.text
    if region.language == "ja" and region.source.startswith("やった、") and re.match(r"yệt\b", text, re.I):
        return False
    if sorted(NUMBER.findall(draft)) != sorted(NUMBER.findall(text)):
        return False
    # A final “không?” is often a question particle, rather than a negation.
    strip_question = lambda line: re.sub(r"\bkhông\s*\?$", "?", line, flags=re.I)
    if len(NEGATION.findall(strip_question(draft))) != len(NEGATION.findall(strip_question(text))):
        return False
    if draft.endswith("?") != text.endswith("?"):
        return False
    if any(re.search(original, region.source, re.I) and re.search(target, draft, re.I)
           and not re.search(target, text, re.I) for original, target in DAY_REFERENCES):
        return False
    # Preserve proper names shared by source and draft, including OCR in all caps.
    names = re.findall(r"(?<!\w)[A-Z][a-z]+(?:-[a-z]+)?", draft)
    return all(not glossary_matches(folded(region.source), name) or glossary_matches(folded(text), name)
               for name in names if folded(name) not in {"i", "you", "no", "yes"})


def polish_dialogue(regions, settings, context, glossary, device, check, protected=()):
    """Edit dialogue before layout. Keep the successful translation on any rejected edit."""
    scene = [region for region in regions if region.text and not region.issue]
    eligible = [region for region in scene if region.id not in protected]
    for region in eligible:
        if re.search(r"\bđi về nhà đi\b", region.text, re.I):
            exact = exact_dialogue(region, glossary)
            if exact and keeps_dialogue_facts(region, exact):
                region.text = exact
        if region.language == "en" and not any(glossary_matches(folded(region.source), key) for key in glossary):
            if FRIENDLY_REASSURANCE.match(folded(region.source)):
                region.text = re.sub(r"^đi thôi(?=,)", "Thôi nào", region.text, flags=re.I)
                if re.search(r"\btớ\b", region.text, re.I):
                    region.text = re.sub(r"\bmày\b", lambda m: "Cậu" if m[0].isupper() or m[0].istitle() else "cậu",
                                         region.text, flags=re.I)
            if date := re.search(r"\bin (\d+) days\b", folded(region.source)):
                count = date[1]
                region.text = re.sub(rf"\btrong {count} ngày tới\b", f"{count} ngày nữa", region.text, flags=re.I)
    if settings.quality == "low":
        return
    if settings.quality != "quality":
        eligible = [region for region in eligible if editorial_note(region, region.text)]
    # Cap extra model work per page. Each call includes nearby successful lines.
    positions = {region.id: index for index, region in enumerate(scene)}
    for index in range(0, min(len(eligible), 12), 6):
        batch = eligible[index:index+6]
        nearby = {position for region in batch for position in range(
            max(0, positions[region.id]-1), min(len(scene), positions[region.id]+2))}
        check()
        try:
            edited = request_polish(batch, [scene[i] for i in sorted(nearby)],
                                    settings, context, glossary, device, check)
        except (OSError, RuntimeError, ValueError, ValidationError):
            continue
        for region in batch:
            text = edited.get(region.id)
            if (text and len(text) <= len(region.text)+min(12, len(region.text)//4)
                    and keeps_dialogue_facts(region, text) and not editorial_note(region, text)):
                region.text = text


def batches(regions, quality):
    count, limit = {"low": (4, 650), "balanced": (7, 1050), "quality": (9, 1350)}[quality]
    eligible = [region for region in regions if not region.issue]
    batch, chars = [], 0
    for index, region in enumerate(eligible):
        size = len(region.source)
        # Keep a short tail with its dialogue when it fits the same text limit.
        # Two extra IDs at most, within the existing quality-mode batch size.
        tail = len(eligible) - index
        absorb_tail = (quality == "balanced" and len(batch) + tail <= 9 and tail <= 2
                       and chars + sum(len(r.source) for r in eligible[index:]) <= limit)
        if batch and (chars + size > limit or (len(batch) >= count and not absorb_tail)):
            yield batch
            batch, chars = [], 0
        batch.append(region)
        chars += size
    if batch:
        yield batch


def translate(regions, settings, context, glossary, check):
    device = settings.device
    groups = list(batches(regions, settings.quality))
    for index, group in enumerate(groups):
        following = groups[index+1][:2] if index+1 < len(groups) else ()
        batch = group
        rejected = {}
        for attempt in range(3):
            check()
            if not batch:
                break
            try:
                accepted = "\n".join(f"{r.source} → {r.text}" for r in group if r.text)
                scene = (context+"\n"+accepted)[-1600:]
                if attempt == 2 and accepted and settings.quality != "quality":
                    scene = accepted
                results, rejected = request_translation(batch, settings, scene, glossary, device,
                                                        check=check, notes=rejected, full_context=attempt == 1,
                                                        following=following)
            except (ValidationError, ValueError):
                rejected = {}
                continue
            except HTTPError as exc:
                if device == "auto" and exc.code >= 500:
                    device = "cpu"
                    continue
                raise RuntimeError(f"Ollama báo lỗi HTTP {exc.code}. Kiểm tra mô hình local.") from exc
            except (TimeoutError, URLError, RuntimeError) as exc:
                if device == "auto":
                    device = "cpu"
                    continue
                raise RuntimeError("Ollama chưa phản hồi hoặc suy luận lỗi. Hãy kiểm tra engine rồi thử lại.") from exc
            remaining = []
            for region in batch:
                text = results.get(region.id) or exact_dialogue(region, glossary)
                if text:
                    region.text = text
                else:
                    remaining.append(region)
            batch = remaining
        for region in batch:
            hint = rejected.get(region.id, "Ollama trả thiếu vùng hoặc JSON không hợp lệ.")
            region.issue = ("Bản dịch làm mất thời điểm của lời chào." if hint.startswith("Preserve ") else hint)
        context += "\n" + "\n".join(f"{r.source} → {r.text}" for r in group if r.text)
    return device
