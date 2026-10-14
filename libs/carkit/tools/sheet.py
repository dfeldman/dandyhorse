"""Tile shots/*.png into contact sheets: python3 tools/sheet.py name1 name2 ... -o out.png"""
import sys, math
from PIL import Image, ImageDraw
args = sys.argv[1:]
out = args[args.index('-o') + 1]; names = args[:args.index('-o')]
ims = [Image.open(f'shots/{n}.png').convert('RGB') for n in names]
w = 640; ims = [im.resize((w, int(im.height * w / im.width))) for im in ims]
h = max(im.height for im in ims); cols = 3 if len(ims) > 4 else 2; rows = math.ceil(len(ims) / cols)
sheet = Image.new('RGB', (cols * w, rows * h), 'white'); d = ImageDraw.Draw(sheet)
for i, (n, im) in enumerate(zip(names, ims)):
    x, y = (i % cols) * w, (i // cols) * h; sheet.paste(im, (x, y)); d.text((x + 6, y + 4), n, fill='black')
sheet.save(out)
