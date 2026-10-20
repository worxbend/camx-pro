"""Copy generated artifacts into the self-contained viewer; never copy private firmware."""
from pathlib import Path
import shutil
from cad.config import ROOT


def main():
    source=ROOT/"exports"
    dest=ROOT/"apps/site/public/downloads"
    # This ignored directory is generated only. Do not retain obsolete P0 parts.
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True,exist_ok=True)
    for directory in ["assembly","parts","plates","drawings","images","reports"]:
        if (source/directory).exists():
            shutil.copytree(source/directory,dest/directory,dirs_exist_ok=True)
    for name in ["manifest.json","engineering.pdf","camx-pro-prototype.zip"]:
        if (source/name).exists():
            shutil.copy2(source/name,dest/name)
    print(f"Staged artifacts at {dest}")


if __name__=="__main__":
    main()
