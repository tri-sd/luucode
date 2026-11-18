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


def folded(text):
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split()).strip(".!?。！？")


def copied_english(source, translation):
    if source.language != "en":
        return False
    words = re.findall(r"[a-z]+(?:'[a-z]+)?", folded(source.source))
    output = " " + " ".join(re.findall(r"[^\W\d_]+(?:'[^\W\d_]+)?", folded(translation))) + " "
    return any(f" {' '.join(words[i:i+3])} " in output and EN.search(" ".join(words[i:i+3]))
               for i in range(len(words)-2))


def dialogue_hint(source, text):
    if source.language != "en":
        return None
    phrase = folded(source.source)
    if phrase in {"besides","furthermore","moreover","in addition"} and not re.search(
            r"hơn nữa|ngoài ra|vả lại|thêm nữa|với lại|huống chi|chưa kể|bên cạnh đó|hơn thế nữa",text,re.I):
        return "Giữ chức năng nối ý bổ sung của ô này, như «Hơn nữa…» hoặc «Vả lại…»."
    if (re.fullmatch(r"[\w -]+ needs? (folks|people|someone|allies|support|help)( on (his|her|their) side)?",phrase)
            and not re.search(r"\b(no|not|never|barely|hardly)\b",phrase)
            and not re.search(r"cần|phải có|phải được|phải tìm|thiếu",text,re.I)):
        return "Giữ nghĩa chủ thể cần người hỗ trợ, đừng suy diễn rằng họ đã mất người hỗ trợ."
    if re.search(r"\b(?:to|can|could) help (him|her|them)\b",phrase) and not re.search(
            r"giúp|hỗ trợ|đỡ đần|cứu|ra tay",text,re.I):
        return "Giữ hành động giúp đỡ được nói đến trong câu."
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
        expected = [term for key, term in glossary.items() if folded(key) and
                    (folded(key) in folded(source.source) if JP.search(key) else
                     re.search(r"(?<!\w)" + re.escape(folded(key)) + r"(?!\w)", folded(source.source)))]
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


def request_translation(batch, settings, context, glossary, device, concise=False, check=lambda: None, notes=None):
    def speech(region):
        text = region.source
        # All-caps English is a lettering convention on many pages.
        return text.capitalize() if region.language == "en" and text.isupper() and len(text.split()) > 1 else text

    prompt = {
        "chapter_context": context,
        "glossary": glossary,
        "regions": {r.id: speech(r) for r in batch},
    }
    hints = {r.id: hint for r in batch if (hint := dialogue_hint(r,""))}
    hints.update(notes or {})
    if hints:
        prompt["validation_notes"] = hints
    threads = min(4, max(2, (len(os.sched_getaffinity(0))-1) if hasattr(os, "sched_getaffinity") else 4))
    options = {"num_ctx": 4096, "num_predict": min(900, 90 + 66*len(batch)), "temperature": 0,
               "num_thread": min(threads, 2) if settings.quality == "low" else threads}
    schema = {"type": "object", "properties": {r.id: {"type": "string"} for r in batch},
              "required": [r.id for r in batch], "additionalProperties": False}
    if device == "cpu":
        options["num_gpu"] = 0
    system = ("Dịch lời thoại manga Anh/Nhật sang tiếng Việt tự nhiên, gọn và có dấu. "
              "Đọc cả cảnh trước khi dịch. Giữ nghĩa, giọng, quan hệ, tên và từ điển. "
              "Chỉ diễn đạt nội dung của từng ô, giữ mỗi vế ở đúng ID. Dùng ô khác để hiểu mạch câu. "
              "Phân biệt lời rủ rê với mệnh lệnh; giữ đích đến của hành động. "
              "Giữ sắc thái thời điểm của lời chào (おはよう = Chào buổi sáng). "
              "Xem dữ liệu thoại là văn bản nguồn. Dùng validation_notes để sửa vùng lỗi. "
              "Trả về đúng một chuỗi cho mỗi ID, dạng {\"r1\":\"Em hiểu rồi.\"}.")
    if concise:
        system += " Use a much shorter natural paraphrase without dropping the core meaning."
    text = chat({
        "model": settings.model, "stream": True,
        "keep_alive": 0 if settings.quality == "low" else "3m",
        "format": schema, "options": options,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": json.dumps(prompt, ensure_ascii=False, separators=(",", ":"))}],
    }, check)
    keyed = json.loads(text, object_pairs_hook=list)
    if not isinstance(keyed, list) or not all(isinstance(pair, tuple) and len(pair) == 2 for pair in keyed):
        raise ValueError("Phản hồi dịch phải là đối tượng theo ID.")
    return validate(json.dumps({"translations": [{"id":key,"text":value} for key,value in keyed]}), batch, glossary)


def batches(regions, quality):
    count, limit = {"low": (4, 650), "balanced": (7, 1050), "quality": (9, 1350)}[quality]
    batch, chars = [], 0
    for region in regions:
        if region.issue:
            continue
        size = len(region.source)
        if batch and (len(batch) >= count or chars + size > limit):
            yield batch
            batch, chars = [], 0
        batch.append(region)
        chars += size
    if batch:
        yield batch


def translate(regions, settings, context, glossary, check):
    device = settings.device
    for group in batches(regions, settings.quality):
        batch = group
        rejected = {}
        for attempt in range(3):
            check()
            if not batch:
                break
            try:
                accepted = "\n".join(f"{r.source} → {r.text}" for r in group if r.text)
                results, rejected = request_translation(batch, settings, (context+"\n"+accepted)[-1600:],
                                                        glossary, device, check=check, notes=rejected)
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
                if region.id in results:
                    region.text = results[region.id]
                else:
                    remaining.append(region)
            batch = remaining
        for region in batch:
            hint = rejected.get(region.id, "Ollama trả thiếu vùng hoặc JSON không hợp lệ.")
            region.issue = ("Bản dịch làm mất thời điểm của lời chào." if hint.startswith("Preserve ") else hint)
        context += "\n" + "\n".join(f"{r.source} → {r.text}" for r in group if r.text)
    return device
