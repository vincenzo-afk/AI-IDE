// FIX: Changed type from File to Blob to allow for more general use cases.
export const fileToBase64 = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // remove "data:mime/type;base64," prefix
      resolve(result.split(',')[1]);
    };
    reader.onerror = (error) => reject(error);
  });

// Audio processing functions for Live API

export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const getFriendlyErrorMessage = (error: unknown): string => {
    const defaultMessage = "An unexpected error occurred. Please check the console for details.";
    let errorMessage = '';
    let errorObject: any = null;

    if (error instanceof Error) {
        errorMessage = error.message;
        try {
            // The API client often puts a JSON string in the message
            const jsonStartIndex = errorMessage.indexOf('{');
            if (jsonStartIndex > -1) {
                errorObject = JSON.parse(errorMessage.substring(jsonStartIndex));
            }
        } catch {
            // Not JSON, continue with string matching
        }
    } else {
        try {
            errorMessage = JSON.stringify(error);
            errorObject = error;
        } catch {
            return defaultMessage;
        }
    }

    const lowerCaseError = errorMessage.toLowerCase();
    
    // Check for quota exhaustion based on object status or string content
    if (errorObject?.error?.status === 'RESOURCE_EXHAUSTED' || lowerCaseError.includes("429") || lowerCaseError.includes("exceeded your current quota")) {
        let retryMessage = "API quota exceeded. Please check your plan and billing details, or try again later.";
        
        const details = errorObject?.error?.details;
        if (Array.isArray(details)) {
            const retryInfo = details.find(d => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
            if (retryInfo && retryInfo.retryDelay) {
                const delay = retryInfo.retryDelay.replace('s', '');
                retryMessage = `API quota exceeded. Please wait ${delay} seconds and try again.`;
            }
        }
        
        return `${retryMessage} More info: ai.google.dev/gemini-api/docs/rate-limits`;
    }

    if (lowerCaseError.includes("requested entity was not found")) {
        return "API Key not found or invalid. Please select a valid API key and ensure billing is enabled. More info: ai.google.dev/gemini-api/docs/billing";
    }

    // Return the specific message from the API if available, otherwise the full error
    return errorObject?.error?.message || errorMessage || defaultMessage;
};