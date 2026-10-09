# Frameforge

So basically this is a tool I made that turns a ZIP of images into a video.
It runs in the browser. Nothing gets uploaded anywhere.

## What it does

You give it a zip file with pictures inside, or just a bunch of images, and it
makes a video out of them. You can set how long each image shows up, the fps,
the resolution, stuff like that. Then you download the video.

I made it mostly for making slideshows and timelapses out of photos without
having to install anything.

## How to use it

1. Put these 3 files in the same folder:
   - index.html
   - styles.css
   - app.js
2. Open index.html in your browser
3. Drop a zip file on the page, or click the buttons to pick files
4. Change the settings if you want
5. Hit "Make video"
6. Download it

That's pretty much it.

## Features

- Drag and drop or click to pick files
- You can keep the zip order or sort by name (this was kind of annoying to get right)
- Uses WebCodecs so the frames are accurate, not like recording the screen in real time
- Set seconds per image and fps
- Resolution presets (1080p, vertical, square, etc) or custom
- Fit modes: contain, cover, stretch
- Pick a background color
- Bitrate slider for quality
- Images get decoded one at a time basically so big zips don't crash the browser
- Handles EXIF rotation so phone photos aren't sideways
- Shows an estimate before you render (how long, how big, how many frames)
- Warnings if your input is too big
- Cancel button
- Download button

## What you need

- A browser with WebCodecs. Chrome, Edge, newer Safari (16.4+), Firefox 130+
- Internet the first time because it loads JSZip and the muxer from a CDN
- On mobile, open it in the actual browser, not inside Instagram or whatever

If your browser doesn't support WebCodecs it'll just say so instead of breaking.

## How it works (roughly)

1. JSZip reads the zip and gets all the image files
2. Sorts them (or not, depending on what you picked)
3. Decodes images as needed (not all at once, that crashed my phone)
4. Draws each image on a canvas
5. Feeds each frame to VideoEncoder
6. webm-muxer puts it all into a WebM file
7. You download it

Your images never leave your computer.

## Output

- WebM file
- VP9 codec (or VP8 if VP9 isn't supported)
- No sound

WebM works in most browsers. But if you wanna send it on WhatsApp or put it
in iOS Photos it might not work, you'd need to convert to mp4. I haven't added
mp4 yet sorry.

## Files

- index.html - the page
- styles.css - styles
- app.js - all the logic

## Some tips

- Name files like 001_photo.jpg, 002_photo.jpg if you want a specific order
- If photos look upside down, it's probably a weird metadata issue
- If rendering is slow, lower the resolution or fps
- Big zips take a while, the estimate thing tells you before you start
- On iPhone, the download link opens in a new tab, tap Share > Save to Files

## Stuff it can't do yet

- No audio
- Only WebM, no MP4
- Needs internet on first load
- Won't work in browsers without WebCodecs
- In-app browsers usually break it

## Ideas for later

- MP4 output
- Add music
- Fade between images
- Ken Burns zoom thing
- Drag to reorder images before rendering
- Make it fully offline by putting the libraries locally
- Read durations from a file in the zip

## Privacy

Nothing gets uploaded. No tracking or anything. Only network calls are the
two library files from the CDN when the page loads.

## License

Do whatever you want with it.
