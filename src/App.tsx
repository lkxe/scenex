import React, {useRef, useState} from 'react';
import {Upload, Play, Download, Settings, X, Pause} from 'lucide-react';
import streamSaver from 'streamsaver';

interface WorkerSuccess {
    frameNumber: number;
    data: Uint8Array;
}

interface WorkerError {
    error: string;
}

type WorkerResponse = WorkerSuccess | WorkerError;

interface ExtendedHTMLVideoElement extends HTMLVideoElement {
    mozDecodedFrames?: number;
    webkitDecodedFrameCount?: number;
}

interface VideoSettings {
    format: 'jpg' | 'png' | 'webp';
    quality: number; // 0.1 to 1.0
    maxWidth: number | null; // For resizing
    extractionMode: 'all' | 'interval' | 'count'; // Simplified from frameLimit
    framesPerSecond: number; // For interval mode
    totalFrames: number; // For count mode
    filenamePattern: string; // For custom file naming patterns
    useOriginalName: boolean;
}


const Logo = () => (
    <div className="w-16 h-16 sm:w-28 sm:h-28 bg-background rounded-full flex items-center justify-center overflow-hidden">
        <div className="w-12 h-12 sm:w-24 sm:h-24 -mt-0.5">
            <img
                src="/logo-animated.svg"
                alt="Video Frame Extractor Logo"
                className="w-full h-full"
                style={{ transform: 'scale(1.2)' }}
            />
        </div>
    </div>
);

const VideoFrameExtractor = () => {
    const [isDragging, setIsDragging] = useState(false);
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [showSettings, setShowSettings] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [videoUrl, setVideoUrl] = useState<string>('');

    const videoRef = useRef<ExtendedHTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = (file: File) => {
        if (file && file.type.startsWith('video/')) {
            setVideoFile(file);
            const url = URL.createObjectURL(file);
            setVideoUrl(url);
            setIsPlaying(false);
            setProgress(0);
        } else {
            alert('Please select a valid video file');
        }
    };

    // Handle drag and drop
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        handleFileSelect(file);
    };

    // Handle file input change
    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            handleFileSelect(e.target.files[0]);
        }
    };

    // Toggle video playback
    const togglePlayback = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    }


    // Updated extraction function
    const [settings, setSettings] = useState<VideoSettings>({
        format: 'webp',
        quality: 1.0,
        maxWidth: null,
        extractionMode: 'all',
        filenamePattern: 'frame_%i',
        useOriginalName: false,
        framesPerSecond: 60,
        totalFrames: 100,
    });

    const generateFilename = (index: number, totalFrames: number, originalName: string): string => {
        const paddingLength = totalFrames >= 10000 ? 5 :
            totalFrames >= 1000 ? 4 :
                totalFrames >= 100 ? 3 : 2;

        const pattern = settings.useOriginalName ?
            originalName.replace(/\.[^/.]+$/, "") + "_%i" :
            settings.filenamePattern;

        return pattern.replace(/%i/g, String(index).padStart(paddingLength, '0')) +
            '.' + settings.format;
    };

    const processFrameInWorker = async (
        worker: Worker,
        imageData: ImageData,
        settings: VideoSettings,
        frameNumber: number
    ): Promise<Uint8Array> => {
        return new Promise((resolve, reject) => {
            const handleMessage = (e: MessageEvent<WorkerResponse>) => {
                if ('error' in e.data) {
                    reject(new Error(e.data.error));
                } else {
                    resolve(e.data.data);
                }
                worker.removeEventListener('message', handleMessage);
            };

            worker.addEventListener('message', handleMessage);
            worker.postMessage({
                imageData,
                settings: {
                    format: settings.format,
                    quality: settings.quality
                },
                frameNumber
            });
        });
    };

    const processFramesWithWorkers = async (
        video: HTMLVideoElement,
        workers: Worker[],
        totalFrames: number,
        frameInterval: number,
        settings: VideoSettings,
        setProgress: (progress: number) => void
    ): Promise<Record<string, Uint8Array>> => {
        const frames: Record<string, Uint8Array> = {};
        let completedFrames = 0;

        // Create frame times queue
        const frameQueue: number[] = [];
        let currentTime = 0;
        while (frameQueue.length < totalFrames && currentTime < video.duration) {
            frameQueue.push(currentTime);
            currentTime += frameInterval;
        }

        // Process frames in parallel batches
        const processNextBatch = async (worker: Worker) => {
            while (frameQueue.length > 0) {
                const frameTime = frameQueue.shift();
                if (frameTime === undefined) break;

                // Seek to frame time and wait for it to be ready
                video.currentTime = frameTime;
                await new Promise(r => video.addEventListener('seeked', r, {once: true}));

                // Capture frame
                const tempCanvas = document.createElement('canvas');
                const ctx = tempCanvas.getContext('2d');
                if (!ctx) throw new Error('Failed to get context');

                // Handle resizing if maxWidth is set
                let targetWidth = video.videoWidth;
                let targetHeight = video.videoHeight;
                if (settings.maxWidth) {
                    const ratio = settings.maxWidth / video.videoWidth;
                    targetWidth = settings.maxWidth;
                    targetHeight = Math.round(video.videoHeight * ratio);
                }

                tempCanvas.width = targetWidth;
                tempCanvas.height = targetHeight;
                ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

                // Process frame
                const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
                const frameData = await processFrameInWorker(worker, imageData, settings, completedFrames);

                // Store frame
                const filename = generateFilename(completedFrames, totalFrames, video.src);
                frames[filename] = frameData;

                completedFrames++;
                setProgress(Math.round((completedFrames / totalFrames) * 100));
            }
        };

        await Promise.all(workers.map(worker => processNextBatch(worker)));
        return frames;
    };

    const createWorkers = (count: number): Worker[] => {
        return Array.from({length: count}, () =>
            new Worker(new URL('./workers/frame.worker.ts', import.meta.url), {type: 'module'})
        );
    };

    const compressFrames = async (
        frames: Record<string, Uint8Array>
    ): Promise<Uint8Array> => {
        return new Promise((resolve, reject) => {
            const worker = new Worker(
                new URL('./workers/compression.worker.ts', import.meta.url)
            );

            worker.onmessage = (e) => {
                if (e.data.error) {
                    reject(new Error(e.data.error));
                    return;
                }
                resolve(e.data.data);
                worker.terminate();
            };

            worker.postMessage({frames});
        });
    };

    const extractFrames = async () => {
        if (!videoRef.current || !canvasRef.current || !videoFile) return;

        const workers = createWorkers(navigator.hardwareConcurrency || 4);

        try {
            setIsProcessing(true);
            setProgress(0);

            const video = videoRef.current;
            const duration = video.duration;

            let frameInterval = 1 / 30; // Default
            let totalFramesToExtract = 0;

            // Use new extractionMode instead of frameLimit
            switch (settings.extractionMode) {
                case 'all':
                    frameInterval = 1 / 60; // Extract at 30fps
                    totalFramesToExtract = Math.ceil(duration * 60);
                    break;
                case 'interval':
                    frameInterval = 1 / settings.framesPerSecond;
                    totalFramesToExtract = Math.ceil(duration * settings.framesPerSecond);
                    break;
                case 'count':
                    totalFramesToExtract = settings.totalFrames;
                    frameInterval = duration / settings.totalFrames;
                    break;
            }

            console.log(`Extracting frames with interval: ${frameInterval}s, total frames: ${totalFramesToExtract}`);

            // Process frames
            const frames = await processFramesWithWorkers(
                video,
                workers,
                totalFramesToExtract,
                frameInterval,
                settings,
                setProgress
            );

            // Compress and download
            const compressedData = await compressFrames(frames);
            await createDownload(compressedData, videoFile.name);

        } catch (error) {
            console.error('Error extracting frames:', error);
            alert('An error occurred while processing frames');
        } finally {
            setIsProcessing(false);
            setProgress(0);
            workers.forEach(worker => worker.terminate());
        }
    };

    const createDownload = async (
        compressedData: Uint8Array,
        originalFilename: string
    ): Promise<void> => {
        const blob = new Blob([compressedData], {
            type: 'application/zip'
        });

        // Use streamsaver for bigger files
        if (blob.size > 100 * 1024 * 1024) {
            const fileStream = streamSaver.createWriteStream(
                `frames_${originalFilename.replace(/\.[^/.]+$/, '')}_${Date.now()}.zip`
            );
            const readableStream = blob.stream();
            await readableStream.pipeTo(fileStream);
        } else {
            // Regular download for smaller files
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `frames_${originalFilename.replace(/\.[^/.]+$/, '')}_${Date.now()}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
    };

    return (
        <div className="min-h-screen bg-background p-4 sm:p-8">
            <canvas ref={canvasRef} className="hidden"/>
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="video/*"
                onChange={handleFileInput}
            />

            <div className="max-w-4xl mx-auto">
                {/* Header Section */}
                <div className="text-center mb-6 sm:mb-8 relative">
                    <div className="flex flex-row items-center justify-center gap-1 sm:gap-3 mb-4">
                        <Logo/>
                        <h1 className="text-4xl sm:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 -ml-2 sm:-ml-3">
                            Scenex
                        </h1>
                    </div>
                    <h2 className="text-xl sm:text-2xl font-medium mb-2 text-gray-400">
                        Video Frame Extractor
                    </h2>
                    <p className="text-gray-400 max-w-md mx-auto text-sm sm:text-base">
                        Extract frames securely in your browser • Privacy-first • No uploads needed
                    </p>
                    <div
                        className="absolute -top-16 sm:-top-20 left-1/2 -translate-x-1/2 w-48 h-48 sm:w-64 sm:h-64 bg-blue-500/10 rounded-full blur-3xl -z-10 animate-pulse"/>
                </div>

                {/* Main Content */}
                <div className="backdrop-blur-xl bg-surface rounded-xl shadow-lg border border-gray-800">
                    {!videoFile && (
                        <div
                            className={`border-2 border-dashed rounded-lg sm:rounded-xl p-6 sm:p-12 text-center transition-all duration-300 mx-4 sm:m-8
                            ${isDragging ? 'border-blue-400 bg-blue-500/10' : 'border-gray-700'}
                            ${isDragging ? 'scale-102' : 'hover:border-gray-600 hover:scale-[1.01]'}`}
                            onDragOver={(e) => {
                                e.preventDefault();
                                setIsDragging(true);
                            }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                        >
                            <div className="flex flex-col items-center">
                                <div className="relative">
                                    <div className="absolute inset-0 rounded-full bg-blue-500/20 blur-xl animate-pulse"/>
                                    <Upload className="w-12 h-12 sm:w-16 sm:h-16 text-blue-400 relative"/>
                                </div>
                                <p className="text-gray-300 mt-4 sm:mt-6 mb-1 sm:mb-2 text-sm sm:text-base">
                                    Drag and drop your video here
                                </p>
                                <p className="text-gray-500 text-xs sm:text-sm mb-4 sm:mb-6">or</p>
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="px-4 py-2 sm:px-6 sm:py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg sm:rounded-xl hover:from-blue-600 hover:to-purple-600 transform hover:scale-105 transition-all duration-300 shadow-md sm:shadow-lg hover:shadow-blue-500/25"
                                >
                                    Select Video
                                </button>
                            </div>
                        </div>
                    )}

                    {videoFile && (
                        <div className="space-y-4 sm:space-y-6 p-4 sm:p-8">
                            {/* Video Preview */}
                            <div
                                className="relative aspect-video bg-black rounded-lg sm:rounded-xl overflow-hidden shadow-lg sm:shadow-2xl border border-border">
                                <video
                                    ref={videoRef}
                                    className="w-full h-full object-contain"
                                    src={videoUrl}
                                    onEnded={() => setIsPlaying(false)}
                                />
                                <div
                                    className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"/>
                                <button
                                    onClick={togglePlayback}
                                    className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur-md p-3 sm:p-4 rounded-full hover:bg-white/20 transition-all duration-300 group"
                                >
                                    {isPlaying ? (
                                        <Pause
                                            className="w-5 h-5 sm:w-6 sm:h-6 text-white group-hover:scale-110 transition-transform"/>
                                    ) : (
                                        <Play
                                            className="w-5 h-5 sm:w-6 sm:h-6 text-white group-hover:scale-110 transition-transform"/>
                                    )}
                                </button>
                                <button
                                    className="absolute top-3 sm:top-4 right-3 sm:right-4 bg-white/10 backdrop-blur-md p-2 sm:p-2.5 rounded-full hover:bg-white/20 transition-all duration-300"
                                    onClick={() => {
                                        setVideoFile(null);
                                        setVideoUrl('');
                                        setIsPlaying(false);
                                    }}
                                >
                                    <X className="w-4 h-4 sm:w-5 sm:h-5 text-white"/>
                                </button>
                            </div>

                            {/* Controls */}
                            <div className="flex flex-wrap items-center justify-between">
                                <button
                                    className="p-3 text-gray-400 hover:text-blue-400 transition-colors bg-background rounded-lg backdrop-blur-md"
                                    onClick={() => setShowSettings(!showSettings)}
                                >
                                    <Settings className="w-5 h-5"/>
                                </button>
                                <button
                                    onClick={extractFrames}
                                    className={`flex items-center space-x-2 px-4 py-2 sm:px-6 sm:py-3 rounded-lg sm:rounded-xl transition-all duration-300
                                    ${isProcessing
                                        ? 'bg-gray-700 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 hover:scale-105 shadow-md sm:shadow-lg hover:shadow-blue-500/25'
                                    }
                                    text-white`}
                                    disabled={isProcessing}
                                >
                                    <Download className="w-4 h-4 sm:w-5 sm:h-5"/>
                                    <span className="text-xs sm:text-sm">
                                        {isProcessing ? 'Processing...' : 'Extract Frames'}
                                    </span>
                                </button>
                            </div>

                            {/* Settings */}
                            {showSettings && (
                                <div className="mt-4 p-4 sm:p-6 bg-background backdrop-blur-md rounded-lg sm:rounded-xl border border-gray-700/50">
                                    <div className="grid grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                                Image Format
                                            </label>
                                            <select
                                                className="w-full bg-surface border border-gray-800 rounded-lg p-2.5 text-gray-300"
                                                value={settings.format}
                                                onChange={(e) => setSettings({
                                                    ...settings,
                                                    format: e.target.value as 'jpg' | 'png' | 'webp'
                                                })}
                                            >
                                                <option value="jpg">JPEG (Smaller files, some quality loss)</option>
                                                <option value="png">PNG (Larger files, no quality loss)</option>
                                                <option value="webp">WebP (Small files, good quality)</option>
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                                Extraction Method
                                            </label>
                                            <select
                                                className="w-full bg-surface border border-gray-800 rounded-lg p-2.5 text-gray-300"
                                                value={settings.extractionMode}
                                                onChange={(e) => setSettings({
                                                    ...settings,
                                                    extractionMode: e.target.value as 'all' | 'interval' | 'count'
                                                })}
                                            >
                                                <option value="all">Extract Every Frame</option>
                                                <option value="interval">Extract at Fixed Interval</option>
                                                <option value="count">Extract Specific Number of Frames</option>
                                            </select>
                                        </div>

                                        {settings.extractionMode === 'interval' && (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                                    Frames Per Second
                                                </label>
                                                <select
                                                    className="w-full bg-surface border border-gray-800 rounded-lg p-2.5 text-gray-300"
                                                    value={settings.framesPerSecond}
                                                    onChange={(e) => setSettings({
                                                        ...settings,
                                                        framesPerSecond: parseInt(e.target.value)
                                                    })}
                                                >
                                                    <option value="1">1 frame per second</option>
                                                    <option value="5">5 frames per second</option>
                                                    <option value="10">10 frames per second</option>
                                                    <option value="24">24 frames per second</option>
                                                    <option value="30">30 frames per second</option>
                                                    <option value="60">60 frames per second</option>
                                                </select>
                                            </div>
                                        )}

                                        {settings.extractionMode === 'count' && (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                                    Total Frames to Extract
                                                </label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="1000"
                                                    value={settings.totalFrames}
                                                    onChange={(e) => setSettings({
                                                        ...settings,
                                                        totalFrames: Math.max(1, parseInt(e.target.value) || 1)
                                                    })}
                                                    className="w-full bg-surface border border-gray-800 rounded-lg p-2.5 text-gray-300"
                                                />
                                                <p className="text-xs text-gray-500 mt-1">Frames will be evenly
                                                    distributed across the video</p>
                                            </div>
                                        )}

                                        {settings.format !== 'png' && (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                                    Image Quality
                                                </label>
                                                <div className="flex items-center space-x-2">
                                                    <input
                                                        type="range"
                                                        min="10"
                                                        max="100"
                                                        value={settings.quality * 100}
                                                        onChange={(e) => setSettings({
                                                            ...settings,
                                                            quality: parseInt(e.target.value) / 100
                                                        })}
                                                        className="flex-1"
                                                    />
                                                    <span className="text-gray-300 w-12 text-right">
                                                        {Math.round(settings.quality * 100)}%
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-500 mt-1">Lower quality = smaller file
                                                    size</p>
                                            </div>
                                        )}

                                        <div>
                                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                                Resize Images
                                            </label>
                                            <select
                                                className="w-full bg-surface border border-gray-800 rounded-lg p-2.5 text-gray-300"
                                                value={settings.maxWidth || 'original'}
                                                onChange={(e) => setSettings({
                                                    ...settings,
                                                    maxWidth: e.target.value === 'original' ? null : parseInt(e.target.value)
                                                })}
                                            >
                                                <option value="original">Original Size</option>
                                                <option value="3840">4K (3840px)</option>
                                                <option value="1920">Full HD (1920px)</option>
                                                <option value="1280">HD (1280px)</option>
                                                <option value="854">SD (854px)</option>
                                            </select>
                                        </div>

                                        <div className="col-span-2">
                                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                                Output Filename
                                            </label>
                                            <div className="flex items-center space-x-4">
                                                <input
                                                    type="text"
                                                    value={settings.filenamePattern}
                                                    placeholder="frame_%i"
                                                    onChange={(e) => setSettings({
                                                        ...settings,
                                                        filenamePattern: e.target.value
                                                    })}
                                                    className="flex-1 bg-surface border border-gray-800 rounded-lg p-2.5 text-gray-300"
                                                    disabled={settings.useOriginalName}
                                                />
                                                <div className="flex items-center space-x-2">
                                                    <input
                                                        type="checkbox"
                                                        id="useOriginalName"
                                                        checked={settings.useOriginalName}
                                                        onChange={(e) => setSettings({
                                                            ...settings,
                                                            useOriginalName: e.target.checked
                                                        })}
                                                        className="rounded border-gray-800 bg-surface text-blue-500"
                                                    />
                                                    <label htmlFor="useOriginalName" className="text-sm text-gray-300">
                                                        Use video filename
                                                    </label>
                                                </div>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1.5">
                                                Use %i for frame number (e.g., "frame_%i" becomes "frame_001.jpg")
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {isProcessing && (
                                <div className="space-y-2">
                                    <div className="h-2 bg-background rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                                            style={{width: `${progress}%`}}
                                        />
                                    </div>
                                    <p className="text-xs sm:text-sm text-gray-400 text-center">{progress}% complete</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="text-center mt-6 sm:mt-8 space-y-2">
                    <p className="text-gray-500 text-xs sm:text-sm">
                        All processing is done locally in your browser. Your video stays private and is never uploaded.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default VideoFrameExtractor;