/**
 * Gallery image picker + size enforcement.
 *
 * Policy: max 2.5 MB after compression. Long edge target ~1600px. JPEG quality
 * iteratively backs off from 0.9 -> 0.4 until the on-disk result fits the cap;
 * we do at most `MAX_ATTEMPTS` passes to bound work.
 *
 * Native imports (`expo-image-picker`, `expo-image-manipulator`,
 * `expo-file-system/legacy`) are lazy so the unit tests can exercise the resize
 * and quality back-off policy without evaluating `react-native`.
 */

export const CHAT_IMAGE_MAX_BYTES = 2.5 * 1024 * 1024;
export const CHAT_IMAGE_LONG_EDGE_PX = 1600;
const MIN_QUALITY = 0.4;
const QUALITY_STEP = 0.1;
const MAX_ATTEMPTS = 6;

export type PickedImage = {
  uri: string;
  width: number;
  height: number;
  byteLength: number;
  mimeType: string;
};

type ImagePickerModule = typeof import("expo-image-picker");
type ImageManipulatorModule = typeof import("expo-image-manipulator");
type FileSystemLegacyModule = typeof import("expo-file-system/legacy");

let imagePickerImport: Promise<ImagePickerModule> | undefined;
let imageManipulatorImport: Promise<ImageManipulatorModule> | undefined;
let fileSystemLegacyImport: Promise<FileSystemLegacyModule> | undefined;

function loadImagePickerModule(): Promise<ImagePickerModule> {
  if (!imagePickerImport) {
    imagePickerImport = import("expo-image-picker");
  }
  return imagePickerImport;
}

function loadImageManipulatorModule(): Promise<ImageManipulatorModule> {
  if (!imageManipulatorImport) {
    imageManipulatorImport = import("expo-image-manipulator");
  }
  return imageManipulatorImport;
}

function loadFileSystemLegacyModule(): Promise<FileSystemLegacyModule> {
  if (!fileSystemLegacyImport) {
    // Main `expo-file-system` getInfoAsync throws at runtime on SDK 55+.
    fileSystemLegacyImport = import("expo-file-system/legacy");
  }
  return fileSystemLegacyImport;
}

function loadCompressModules(): Promise<[ImageManipulatorModule, FileSystemLegacyModule]> {
  return Promise.all([loadImageManipulatorModule(), loadFileSystemLegacyModule()]);
}

/**
 * Start importing image modules in the background after chat UI is up.
 * Safe to call more than once; does not block the caller.
 */
export function warmChatImageModules(): void {
  void loadImagePickerModule();
  void loadCompressModules();
}

export async function pickGalleryImage(): Promise<PickedImage | undefined> {
  // Open picker as soon as ImagePicker is ready; warm compress deps in parallel
  // so a fast gallery selection does not stall on Metro after the user picks.
  const pickerReady = loadImagePickerModule();
  const compressReady = loadCompressModules();
  const ImagePicker = await pickerReady;
  const result = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: false,
    quality: 1,
    mediaTypes: ["images"],
    selectionLimit: 1
  });
  if (result.canceled || result.assets.length === 0) return undefined;
  await compressReady;
  const asset = result.assets[0]!;
  const compressed = await compressForChat({
    uri: asset.uri,
    width: asset.width ?? CHAT_IMAGE_LONG_EDGE_PX,
    height: asset.height ?? CHAT_IMAGE_LONG_EDGE_PX,
    fileSize: asset.fileSize ?? Number.POSITIVE_INFINITY
  });
  return compressed;
}

export type CompressInput = {
  uri: string;
  width: number;
  height: number;
  fileSize: number;
  /** Hook for tests: simulate `expo-image-manipulator` deterministically. */
  manipulate?: ManipulateFn;
  /** Hook for tests: simulate file size of the manipulated output. */
  measure?: (uri: string) => Promise<number>;
};

type ManipulateFn = (
  uri: string,
  width: number,
  height: number,
  quality: number
) => Promise<{ uri: string; width?: number; height?: number }>;

export async function compressForChat(input: CompressInput): Promise<PickedImage> {
  const manipulate = input.manipulate ?? manipulateForChat;
  const measure = input.measure ?? defaultMeasureFileSize;

  const longEdge = Math.max(input.width, input.height);
  const scale = longEdge > CHAT_IMAGE_LONG_EDGE_PX ? CHAT_IMAGE_LONG_EDGE_PX / longEdge : 1;
  const targetWidth = Math.round(input.width * scale);
  const targetHeight = Math.round(input.height * scale);

  let quality = 0.9;
  let attempt = 0;
  let lastResult = await manipulate(input.uri, targetWidth, targetHeight, quality);
  let bytes = await measure(lastResult.uri);

  while (bytes > CHAT_IMAGE_MAX_BYTES && quality > MIN_QUALITY && attempt < MAX_ATTEMPTS) {
    quality = Math.max(MIN_QUALITY, quality - QUALITY_STEP);
    lastResult = await manipulate(input.uri, targetWidth, targetHeight, quality);
    bytes = await measure(lastResult.uri);
    attempt += 1;
  }

  return {
    uri: lastResult.uri,
    width: lastResult.width ?? targetWidth,
    height: lastResult.height ?? targetHeight,
    byteLength: bytes,
    mimeType: "image/jpeg"
  };
}

const manipulateForChat: ManipulateFn = async (uri, width, height, quality) => {
  const ImageManipulator = await loadImageManipulatorModule();
  const out = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width, height } }],
    {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG
    }
  );
  return { uri: out.uri, width: out.width, height: out.height };
};

async function defaultMeasureFileSize(uri: string): Promise<number> {
  const fs = await loadFileSystemLegacyModule();
  const info = await fs.getInfoAsync(uri);
  if (info.exists && typeof info.size === "number") return info.size;
  return 0;
}
