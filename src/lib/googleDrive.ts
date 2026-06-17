import { SongData } from '../types';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FILES_API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

let _tokenClient: any = null;
let _accessToken: string | null = null;

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

// Load the Google Identity Services script dynamically, then initialize.
// onToken is called with the token string when signed in, or null when signed out / on error.
export function initDriveAuth(clientId: string, onToken: (token: string | null) => void) {
  if ((window as any).__gisLoaded) {
    _createTokenClient(clientId, onToken);
    return;
  }

  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  script.onload = () => {
    (window as any).__gisLoaded = true;
    _createTokenClient(clientId, onToken);
  };
  document.head.appendChild(script);
}

function _createTokenClient(clientId: string, onToken: (token: string | null) => void) {
  _tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: (response: any) => {
      if (response.error) {
        _accessToken = null;
        onToken(null);
        return;
      }
      _accessToken = response.access_token;
      onToken(response.access_token);
    },
  });

  // Attempt silent sign-in for returning users (no popup if already authorized)
  _tokenClient.requestAccessToken({ prompt: '' });
}

// Show the Google sign-in / consent popup
export function requestGoogleSignIn() {
  if (!_tokenClient) throw new Error('Drive auth not initialized');
  _tokenClient.requestAccessToken({ prompt: 'select_account' });
}

export function signOutFromDrive(onToken: (token: string | null) => void) {
  if (_accessToken && (window as any).google?.accounts?.oauth2) {
    (window as any).google.accounts.oauth2.revoke(_accessToken, () => {});
  }
  _accessToken = null;
  onToken(null);
}

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${_accessToken}` };
}

export async function listDriveFiles(): Promise<DriveFile[]> {
  const q = encodeURIComponent("name contains '.aurelia'");
  const res = await fetch(
    `${FILES_API}?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime+desc`,
    { headers: authHeader() }
  );
  if (res.status === 401) { _accessToken = null; throw new Error('auth'); }
  if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
  const data = await res.json();
  return (data.files ?? []) as DriveFile[];
}

export async function saveToDrive(song: SongData, fileId?: string | null): Promise<string> {
  const name = `${(song.title || 'Untitled').replace(/[/\\?%*:|"<>]/g, '_')}.aurelia`;
  const body = JSON.stringify(song, null, 2);

  const meta = { name, mimeType: 'application/json' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', new Blob([body], { type: 'application/json' }));

  const url = fileId
    ? `${UPLOAD_API}/${fileId}?uploadType=multipart`
    : `${UPLOAD_API}?uploadType=multipart`;

  const res = await fetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: authHeader(),
    body: form,
  });
  if (res.status === 401) { _accessToken = null; throw new Error('auth'); }
  if (!res.ok) throw new Error(`Drive save failed: ${res.status}`);
  const data = await res.json();
  return data.id as string;
}

export async function loadFromDrive(fileId: string): Promise<SongData> {
  const res = await fetch(`${FILES_API}/${fileId}?alt=media`, {
    headers: authHeader(),
  });
  if (res.status === 401) { _accessToken = null; throw new Error('auth'); }
  if (!res.ok) throw new Error(`Drive load failed: ${res.status}`);
  return await res.json() as SongData;
}

export async function deleteFromDrive(fileId: string): Promise<void> {
  const res = await fetch(`${FILES_API}/${fileId}`, {
    method: 'DELETE',
    headers: authHeader(),
  });
  if (res.status === 401) { _accessToken = null; throw new Error('auth'); }
  if (!res.ok && res.status !== 204) throw new Error(`Drive delete failed: ${res.status}`);
}
