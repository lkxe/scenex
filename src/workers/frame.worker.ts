declare const self: Worker;

self.onmessage = async (e: MessageEvent) => {
    const { imageData, settings, frameNumber } = e.data;

    try {
        const canvas = new OffscreenCanvas(imageData.width, imageData.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Failed to get context');

        context.putImageData(imageData, 0, 0);

        const mimeType = `image/${settings.format}`;
        let quality = settings.quality;

        // PNG doesn't use quality setting
        if (settings.format === 'png') {
            quality = undefined;
        }

        const blob = await canvas.convertToBlob({
            type: mimeType,
            quality
        });

        const buffer = await blob.arrayBuffer();

        self.postMessage({
            frameNumber,
            data: new Uint8Array(buffer)
        }, [buffer]);
    } catch (error) {
        self.postMessage({
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};