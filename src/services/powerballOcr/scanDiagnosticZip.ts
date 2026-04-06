/**
 * Pack scan_debug into a ZIP.
 * - iOS：可用 `Share.share({ url })` 把 ZIP 当文件分享（如隔空投送、存文件）。
 * - Android：RN `Share` 不会附带 `url`；发给 ChatGPT 请用「保存到所选文件夹」+「打开 ChatGPT 上传」。
 * - 保存到所选文件夹: Android 用 SAF `requestDirectoryPermissionsAsync` + `createFileAsync` + legacy 写入；iOS 用 `Directory.pickDirectoryAsync`。
 */
import {
  cacheDirectory,
  deleteAsync,
  EncodingType,
  readAsStringAsync,
  readDirectoryAsync,
  StorageAccessFramework,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';
import { Linking, Platform, Share } from 'react-native';

/** ChatGPT 网页版（附件上传）；不依赖额外原生模块。 */
export const CHATGPT_DIAGNOSTIC_UPLOAD_URL = 'https://chatgpt.com/';

export async function openChatGptForDiagnosticUpload(): Promise<void> {
  await Linking.openURL(CHATGPT_DIAGNOSTIC_UPLOAD_URL);
}

/** Recursively add files under `dirUri` into `zip` at `zipPrefix` (e.g. "cell_compare/"). */
async function addDirectoryToZip(
  zip: JSZip,
  dirUri: string,
  zipPrefix: string,
): Promise<void> {
  const base = dirUri.replace(/\/*$/, '');
  const names = await readDirectoryAsync(`${base}/`);
  for (const name of names) {
    const path = `${base}/${name}`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) continue;
    const entryName = `${zipPrefix}${name}`;
    if (info.isDirectory) {
      await addDirectoryToZip(zip, path, `${entryName}/`);
      continue;
    }
    const b64 = await readAsStringAsync(path, { encoding: EncodingType.Base64 });
    zip.file(entryName, b64, { base64: true });
  }
}

/** Build ZIP under cache; returns `file://` path to `.zip`. */
export async function buildScanDiagnosticZipFile(diagnosticFolderUri: string): Promise<string> {
  const base = diagnosticFolderUri.replace(/\/*$/, '');
  const names = await readDirectoryAsync(`${base}/`);
  const zip = new JSZip();

  for (const name of names) {
    const path = `${base}/${name}`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) continue;
    if (info.isDirectory) {
      await addDirectoryToZip(zip, path, `${name}/`);
      continue;
    }
    const b64 = await readAsStringAsync(path, { encoding: EncodingType.Base64 });
    zip.file(name, b64, { base64: true });
  }

  const zipB64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  if (!cacheDirectory) {
    throw new Error('No cache directory available.');
  }
  const outPath = `${cacheDirectory}lottopilot_scan_diag_${Date.now()}.zip`;
  await writeAsStringAsync(outPath, zipB64, { encoding: EncodingType.Base64 });
  return outPath;
}

/**
 * iOS：打包 ZIP 并用系统分享面板发出（真实文件）。
 * 其它平台请用 `openChatGptForDiagnosticUpload` + `saveScanDiagnosticFolderToChosenDirectory`。
 */
export async function shareScanDiagnosticFolderAsZip(folderUri: string): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('Export is not available on web.');
  }
  if (Platform.OS !== 'ios') {
    throw new Error('当前系统请使用「保存到所选文件夹」保存 ZIP，再打开 ChatGPT 上传附件。');
  }

  const outPath = await buildScanDiagnosticZipFile(folderUri);
  await Share.share({ url: outPath });
}

/**
 * Opens the system folder picker (Downloads、Documents、iCloud 等)，在用户选定目录中创建 ZIP 并写入。
 * iOS：对该目录的访问通常仅限当前 App 会话，重启后需重新授权。
 */
export async function saveScanDiagnosticFolderToChosenDirectory(folderUri: string): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('Export is not available on web.');
  }

  const outPath = await buildScanDiagnosticZipFile(folderUri);

  try {
    if (Platform.OS === 'android') {
      /**
       * Do not use `Directory.createFile` on Android: the new File API can trigger `FileSystemFile.copy`,
       * which calls `javaFile` and throws on content:// URIs.
       * Use legacy StorageAccessFramework + writeAsStringAsync(Base64) only (see FileSystemLegacyModule.kt).
       */
      const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync(null);
      if (!perm.granted) {
        throw new Error('已取消或未选择文件夹。');
      }
      const parentUri = perm.directoryUri;
      const baseName = `lottopilot_scan_diag_${Date.now()}`;
      const destUri = await StorageAccessFramework.createFileAsync(
        parentUri,
        baseName,
        'application/zip',
      );
      const zipB64 = await readAsStringAsync(outPath, { encoding: EncodingType.Base64 });
      await writeAsStringAsync(destUri, zipB64, { encoding: EncodingType.Base64 });
    } else {
      const { Directory } = await import('expo-file-system');
      const picked = await Directory.pickDirectoryAsync();
      const fileName = `lottopilot_scan_diag_${Date.now()}.zip`;
      const destFile = picked.createFile(fileName, 'application/zip');
      const destUri = destFile.uri;
      if (destUri.startsWith('file:')) {
        await FileSystem.copyAsync({ from: outPath, to: destUri });
      } else {
        const zipB64 = await readAsStringAsync(outPath, { encoding: EncodingType.Base64 });
        await writeAsStringAsync(destUri, zipB64, { encoding: EncodingType.Base64 });
      }
    }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    if (/cancel|cancelled|dismiss|abort|user/i.test(msg)) {
      throw new Error('已取消或未选择文件夹。');
    }
    throw e;
  } finally {
    try {
      await deleteAsync(outPath, { idempotent: true });
    } catch {
      /* ignore */
    }
  }
}
