from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field

Quality = Literal["balanced", "quality", "low"]
Font = Literal["regular", "bold", "italic"]
Coord = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
Box = tuple[Coord, Coord, Coord, Coord]
Point = tuple[Coord, Coord]
Text = Annotated[str, Field(max_length=500)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Settings(Strict):
    language: Literal["auto", "en", "ja"] = "auto"
    quality: Quality = "balanced"
    model: str = Field(default="qwen3:4b-instruct-2507-q4_K_M", pattern=r"^[\w.-]{1,80}(?::[\w.-]{1,80})?$")
    device: Literal["auto", "cpu"] = "auto"
    font: Font = "regular"
    font_scale: float = Field(default=1, ge=.7, le=1.5)
    sfx: bool = False


class Region(Strict):
    id: str
    box: Box
    polygons: list[list[Point]]
    orientation: Literal["horizontal", "vertical"]
    confidence: Coord | None = None
    language: Literal["en", "ja"] | None = None
    source: Text = ""
    text: Text = ""
    issue: str = ""
    bubble: Box | None = None
    placement: Box | None = None
    font: Font | None = None
    font_scale: float | None = Field(default=None, ge=.7, le=1.5)


class Edit(Strict):
    id: str = Field(pattern=r"^r[1-9][0-9]{0,2}$")
    text: Text
    placement: Box | None = None
    font: Font | None = None
    font_scale: float | None = Field(default=None, ge=.7, le=1.5)


class PageInput(Strict):
    image: str = Field(max_length=29_360_128)
    settings: Settings
    context: str = Field(default="", max_length=2200)
    force: bool = False


class Translation(Strict):
    id: str
    text: Annotated[str, Field(min_length=1, max_length=500)]


class Translations(Strict):
    translations: list[Translation] = Field(max_length=16)
