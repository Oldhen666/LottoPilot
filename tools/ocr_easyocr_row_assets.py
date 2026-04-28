"""One-off: EasyOCR on row_*_clean PNGs from Cursor assets."""
import re
from pathlib import Path

import easyocr

ASSETS = r"C:\Users\xiang\.cursor\projects\c-Users-xiang-Documents-projects-LottoPilot\assets"
IMAGES = [
    f"{ASSETS}\\c__Users_xiang_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_row_00_clean-33e982ba-8c6d-4fac-937f-f97caed60f47.png",
    f"{ASSETS}\\c__Users_xiang_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_row_01_clean-068582f1-96e9-4538-a535-e45729f6d8ac.png",
    f"{ASSETS}\\c__Users_xiang_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_row_02_clean-75b7b422-b583-47b8-aff7-17aa87545514.png",
    f"{ASSETS}\\c__Users_xiang_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_row_03_clean-972e3635-db68-4d3c-a743-e81e782d8696.png",
    f"{ASSETS}\\c__Users_xiang_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_row_04_clean-528b4d79-aae6-4b6d-a8f2-6639549cfad8.png",
]


def digits_only(s: str) -> str:
    return re.sub(r"\D+", " ", s).strip()


def main() -> None:
    reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    for path in IMAGES:
        rows = reader.readtext(
            path,
            detail=1,
            paragraph=False,
            allowlist="0123456789 ",
        )
        joined = " | ".join(f"{t[1]} ({t[2]:.2f})" for t in rows)
        raw = " ".join(t[1] for t in rows)
        print("---")
        stem = Path(path).name
        tag = re.search(r"row_(\d+)_clean", stem)
        label = f"row_{tag.group(1)}" if tag else stem[:40]
        print(label, "|", stem[:70] + "…" if len(stem) > 70 else stem)
        print("raw:", raw)
        print("digits:", digits_only(raw))


if __name__ == "__main__":
    main()
