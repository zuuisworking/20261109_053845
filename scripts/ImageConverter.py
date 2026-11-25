from PIL import Image
from pathlib import Path
from os import getcwd

CWD = Path.cwd()
TEMP_DIR = CWD / ".temp"
ASSETS_DIR = CWD / "frontend" / 'assets'

def convert_to_png(filepath: Path, output_filename: str):
    im = Image.open(filepath)
    im.save(ASSETS_DIR / f"{output_filename}.png")

def main():
    convert_to_png(
        filepath=TEMP_DIR / 'sigap' / 'Tema_Utama.jfif',
        output_filename='bg_landing_page'
    )

if __name__ == '__main__':
    main()