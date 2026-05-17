# Hebrew Explanations Guide

The app now supports Hebrew explanations/translations for all technical terms and button labels. Users see these when they hover over UI elements.

## How to Update Explanations

Edit the file: `frontend/src/explanations.json`

The JSON file has four sections:

### 1. **acronyms** — Technical terms and abbreviations
- `EFT` - External Fuel Tank (טנק דלק חיצוני)
- `FCR` - Fire Control Radar (מכ"ם חיפוש ותקיפה)
- `OGE` - Out of Ground Effect (מחוץ לקרקע)
- `IGE` - In Ground Effect (בקרבת קרקע)
- etc.

### 2. **buttons** — Button labels with explanations
- `ADD` - "הוסף נקודת דרך חדשה" (Add new waypoint)
- `DELETE` - "מחק נקודות מסומנות" (Delete selected waypoints)
- `REV` - "הפוך את סדר הנקודות" (Reverse waypoint order)
- etc.

### 3. **labels** — UI labels and section headers
- `WAYPOINTS` - "נקודות דרך - צמודים המגדירים את מסלול הטיסה"
- `WING_STORES` - "אביזרים בכנפיים - טנקים, טילים, רקטות"
- etc.

### 4. **fields** — Data field explanations
- `lat` - "קו רוחב" (Latitude)
- `lon` - "קו אורך" (Longitude)
- `altitude` - "גובה הטיסה בנקודה זו"
- etc.

## Example: Adding a New Explanation

To add an explanation for a new button or term:

1. Open `frontend/src/explanations.json`
2. Find the appropriate section (acronyms, buttons, labels, or fields)
3. Add a new line: `"TERM_NAME": "הסבר בעברית"`
4. Save the file

The app will automatically use the new explanation the next time it's reloaded.

## Example: Updating an Existing Explanation

1. Open `frontend/src/explanations.json`
2. Find the term/button/label you want to update
3. Change the Hebrew text
4. Save the file
5. Refresh the browser (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)

Changes take effect immediately without restarting the server.

## Where Explanations Appear

- Hover over any button label in the UI
- Hover over section headers (WING STORES, WAYPOINTS, etc.)
- Hover over acronyms and technical terms (ATF, FCR, EFT, etc.)

## Current Coverage

- Wing Stores panel: ATF, FCR, COMPOD, etc.
- Waypoint panel: ADD, REV, DELETE, ALL, CANCEL buttons
- Most common acronyms and terms

To expand coverage, simply add more entries to the appropriate section in `explanations.json`.
