
# The Scottish Golf Rating Toolkit

A high-precision measurement tool designed for golf course rating.

## Features

### 1. Distance Tracker (with Pivots)
- **Real-time GNSS Tracking**: Measures horizontal distance and elevation change.
- **Pivot Points**: Support for up to 3 pivot points to measure dog-legs or multi-stage holes.
- - **Shot Accuracy**: Displays graphically the likely shot accuracy for scratch and bogey players.
- **Elevation Delta**: Tracks vertical movement from start to finish.

### 2. Green Mapper
- **Area Calculation**: Walk the perimeter of a green to calculate its total area in yards or metres.
- **Bunker Integration**: Hold the "Bunker" button while walking specific sections to track bunker length and percentage of the total perimeter.
- **Automatic Closing**: The tool detects when you've returned to the starting point to finalize the shape.
- **Section 13 Compliance**: Automatic calculation of Effective Green Diameter (EGD) per January 2024 Course Rating Manual.

### 3. Visual Accessibility
- **Large Text Mode**: The readme is accessible - A user-selectable toggle in the app header allows for increased font sizes, significantly improving readability in bright sunlight or for users with visual impairments.

## Tech Stack
- **React / TypeScript**
- **Leaflet**: High-performance mapping and satellite overlays.
- **Tailwind CSS**: Modern, mobile-first UI.
- **Lucide**: Clean iconography.

## Deployment
This is a single-page application (SPA) that stores history locally on the device using `localStorage`.
