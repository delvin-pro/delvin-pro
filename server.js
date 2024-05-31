const express = require('express');
const bodyParser = require('body-parser');
const ytdl = require('ytdl-core');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { promisify } = require('util');

const app = express();
const unlinkAsync = promisify(fs.unlink);

// Use ffmpeg-static binary
ffmpeg.setFfmpegPath(ffmpegStatic);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let totalSize = 0;
let downloadedSize = 0;
let progressUpdateInterval;

app.post('/download', async (req, res) => {
    const videoUrl = req.body.url;
    const resolution = req.body.resolution || '360p'; // Default resolution to 360p
    console.log('Received URL: ', videoUrl, 'Resolution: ', resolution);

    if (ytdl.validateURL(videoUrl)) {
        const videoId = ytdl.getURLVideoID(videoUrl);
        const videoPath = path.join(__dirname, `temp_${videoId}_video.mp4`);
        const audioPath = path.join(__dirname, `temp_${videoId}_audio.mp4`);
        const outputPath = path.join(__dirname, `video_${videoId}.mp4`);

        totalSize = 0;
        downloadedSize = 0;

        try {
            // Download video with the selected resolution
            await downloadStream(ytdl(videoUrl, { filter: format => format.container === 'mp4' && format.qualityLabel === resolution }), videoPath);
            // Download audio
            await downloadStream(ytdl(videoUrl, { filter: 'audioonly' }), audioPath);

            // Merge video and audio
            await mergeStreams(videoPath, audioPath, outputPath);

            // Send the merged file
            res.download(outputPath, 'video.mp4', async (err) => {
                if (err) {
                    console.error('Error sending file:', err);
                    res.status(500).send('Error sending file');
                }

                // Clean up temporary files
                await unlinkAsync(videoPath);
                await unlinkAsync(audioPath);
                await unlinkAsync(outputPath);
            });
        } catch (err) {
            console.error('Error during download and merge:', err);
            res.status(500).send('Error downloading video');
        }
    } else {
        console.log('Invalid URL');
        res.status(400).send('Invalid URL');
    }
});

app.get('/progress', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    progressUpdateInterval = setInterval(() => {
        const progress = (downloadedSize / totalSize * 100).toFixed(2);
        res.write(`data: ${progress}\n\n`);
    }, 1000);

    req.on('close', () => {
        clearInterval(progressUpdateInterval);
        res.end();
    });
});

const downloadStream = (stream, filePath) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filePath);
        stream.pipe(file);

        stream.on('progress', (chunkLength, downloaded, total) => {
            totalSize = total;
            downloadedSize = downloaded;
        });

        stream.on('info', (info) => {
            totalSize = info.length;
        });

        stream.on('end', () => {
            file.end();
            resolve();
        });

        stream.on('error', (err) => {
            reject(err);
        });
    });
};

const mergeStreams = (videoPath, audioPath, outputPath) => {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(videoPath)
            .input(audioPath)
            .outputOptions('-c:v copy')
            .outputOptions('-c:a aac')
            .save(outputPath)
            .on('end', () => {
                resolve();
            })
            .on('error', (err) => {
                reject(err);
            });
    });
};

app.get('/videoInfo', async (req, res) => {
    const videoURL = req.query.url;
    try {
        const info = await ytdl.getInfo(videoURL);
        res.json({
            title: info.videoDetails.title,
            author: info.videoDetails.author.name,
            description: info.videoDetails.description,
            publishDate: info.videoDetails.publishDate,
            formats: info.formats.filter(format => format.container === 'mp4' && format.hasVideo).map(format => format.qualityLabel)
        });
    } catch (error) {
        console.error('Error fetching video info:', error);
        res.status(500).send('Error fetching video info');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
