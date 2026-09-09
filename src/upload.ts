/**
 * Turn a picked file into a decoded image. Each rejection carries its own
 * message; M3 is where these get more specific (IN-2, IN-3, IN-4).
 */
export function readImageFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) {
            reject(new Error('Please choose a supported image file.'));
            return;
        }

        const reader = new FileReader();
        reader.onerror = () => reject(new Error('The image could not be read. Please try another file.'));
        reader.onload = (event) => {
            const img = new Image();
            img.onerror = () => reject(new Error('The image could not be decoded. Please try another file.'));
            img.onload = () => resolve(img);
            img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
    });
}
