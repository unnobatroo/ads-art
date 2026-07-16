type ArtworkAspect = 'landscape' | 'portrait' | 'square';

interface Artwork {
  id: string;
  title: string;
  artist: string;
  date: string;
  source: string;
  imageId: string | null;
  imageUrl: string | null;
  smallImageUrl: string | null;
  width: number;
  height: number;
}

interface CachedArtwork extends Artwork {
  cachedAt: number;
}

interface GetArtMessage {
  type: 'GET_ART';
  width: number;
  height: number;
}

interface GetArtResponse {
  artwork: Artwork | null;
}

interface ArtReplacerApi {
  detectAds?: (container?: Document | HTMLElement) => HTMLElement[];
  startObserver?: (
    onAdFound: (adElements: HTMLElement[]) => void | Promise<void>
  ) => MutationObserver | null;
}

interface Window {
  __artReplacer?: ArtReplacerApi;
}
