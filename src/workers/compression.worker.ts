declare const self: Worker;

self.onmessage = async (e: MessageEvent) => {
    const { frames, level } = e.data;

    try {
        // Create a ZIP archive using JSZip
        const JSZip = await import('jszip');
        const zip = new JSZip.default();

        // Add each frame to the ZIP
        Object.entries(frames).forEach(([filename, data]) => {
            zip.file(filename, data);
        });

        // Generate the ZIP with compression
        const zipData = await zip.generateAsync({
            type: 'uint8array',
            compression: 'DEFLATE',
            compressionOptions: {
                level: level || 6
            }
        });

        self.postMessage({ data: zipData });
    } catch (error) {
        self.postMessage({
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};