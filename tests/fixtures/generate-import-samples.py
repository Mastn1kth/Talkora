"""Generate small bilingual files for manual PDF/OCR browser checks."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


directory = Path(__file__).parent
font_path = Path(r"C:\Windows\Fonts\arial.ttf")
if not font_path.exists():
    raise SystemExit("Arial font is required for this Windows test fixture")

lines = ["hello — привет", "airport — аэропорт"]
pdfmetrics.registerFont(TTFont("FixtureArial", str(font_path)))
document = canvas.Canvas(str(directory / "word-list.pdf"))
document.setFont("FixtureArial", 22)
for index, line in enumerate(lines):
    document.drawString(50, 750 - index * 38, line)
document.save()

image = Image.new("RGB", (1100, 240), "white")
draw = ImageDraw.Draw(image)
font = ImageFont.truetype(str(font_path), 45)
for index, line in enumerate(lines):
    draw.text((35, 25 + index * 95), line, fill="black", font=font)
image.save(directory / "word-list.png")

scan = canvas.Canvas(str(directory / "word-list-scan.pdf"))
scan.drawImage(str(directory / "word-list.png"), 40, 600, width=550, height=120)
scan.save()
