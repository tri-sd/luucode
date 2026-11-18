from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent / "fixtures"
VI = Path(__file__).resolve().parents[1] / "local-ai-engine/fonts/NotoSans.ttf"
JP = Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")


def page(name, scripts):
    image = Image.new("RGB", (720, 960), "#b2c7d1")
    draw = ImageDraw.Draw(image)
    for y in range(0, 940, 240):
        draw.rectangle((13, y+15, 707, y+233), outline="#394653", width=4)
        draw.line((20, y+220, 200, y+200), fill="#728b9a", width=3)
    for center, lines, is_jp, vertical, bg in scripts:
        x, y = center
        draw.ellipse((x-150, y-86, x+150, y+86), fill=bg, outline="#333342", width=3)
        font = ImageFont.truetype(str(JP if is_jp else VI), 24 if vertical else 30)
        if vertical:
            for i, char in enumerate(lines[0]):
                draw.text((x, y+(i-(len(lines[0])-1)/2)*26), char, font=font, fill="#17171a", anchor="mm")
        else:
            for i, line in enumerate(lines):
                draw.text((x, y+(i-(len(lines)-1)/2)*39), line, font=font, fill="#17171a", anchor="mm")
    image.save(ROOT / f"{name}.png")


if __name__ == "__main__":
    ROOT.mkdir(exist_ok=True)
    page("english", [
        ((470, 128), ["GOOD", "MORNING!"], False, False, "#ffffff"),
        ((215, 364), ["LET'S GO", "HOME."], False, False, "#ffefcb"),
        ((470, 606), ["THANK YOU!"], False, False, "#ffffff"),
    ])
    page("japanese", [
        ((475, 128), ["おはよう！"], True, False, "#ffffff"),
        ((220, 128), ["ありがとう"], True, False, "#ffffff"),
        ((460, 365), ["行こう！"], True, True, "#f9ebc9"),
    ])
