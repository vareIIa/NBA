# Junta os prints de tools/arremesso-folha.mjs de uma vista numa grade (8 colunas) com o número do quadro.
#   python tools/arremesso-folha.py <pasta> <vista: side|front> <saida.png>
import glob
import os
import sys

from PIL import Image, ImageDraw

folder, view, out = sys.argv[1], sys.argv[2], sys.argv[3]
files = sorted(glob.glob(os.path.join(folder, f'{view}_*.png')))
ims = [Image.open(f).convert('RGB').resize((240, 312)) for f in files]
cols = 8
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * 240, rows * 312), 'black')
for i, (im, f) in enumerate(zip(ims, files)):
    ImageDraw.Draw(im).text((4, 4), os.path.basename(f)[-7:-4], fill='yellow')
    sheet.paste(im, ((i % cols) * 240, (i // cols) * 312))
sheet.save(out)
print(out, len(ims))
