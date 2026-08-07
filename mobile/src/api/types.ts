export interface AlbumTrackEntry {
  played_at: string;
  track_id: string;
  track_name: string;
  is_favorited: boolean;
  is_revisit: boolean;
}

export interface VinylTrack {
  position: string;
  title: string;
  duration?: string | null;
}

export interface RecentAlbum {
  album_id: string;
  album_name: string;
  artist: string;
  release_year: number | null;
  art_local_path: string | null;
  art_url: string | null;
  art_filename?: string | null;
  source?: "spotify" | "vinyl";
  vinyl_type?: string | null;
  tracklist?: VinylTrack[];
  played_at?: string;
  entries: AlbumTrackEntry[];
}

export interface RecentAlbumsResponse {
  albums: RecentAlbum[];
}

// ─── Artists ──────────────────────────────────────────────────────────────────

export interface ArtistListAlbum {
  album_id: string;
  art_filename: string | null;
  count: number;
  latest_played: string;
}

export interface ArtistListItem {
  name: string;
  play_count: number;
  latest_played: string;
  is_favorited: boolean;
  genres: string[];
  albums: ArtistListAlbum[];
}

export interface ArtistsResponse {
  artists: ArtistListItem[];
  all_genres: string[];
}

export interface ArtistTrackPlay {
  track_id: string;
  track_name: string;
  track_number: number;
  play_count: number;
  is_favorited: boolean;
}

export interface ArtistDetailAlbum {
  album_id: string;
  album_name: string;
  artist: string;
  art_filename: string | null;
  release_year: number | null;
  album_type: string;
  count: number;
  classified_type: string;
  is_favorited: boolean;
  rating: number;
  track_plays: ArtistTrackPlay[];
}

export interface ArtistDetail {
  name: string;
  play_count: number;
  artist_id: string;
  genres: string[];
  is_favorited: boolean;
  albums: ArtistDetailAlbum[];
  top_tracks: { track_id: string; track_name: string; count: number }[];
}

export interface AlbumListItem {
  album_id: string;
  album_name: string;
  artist: string;
  art_filename: string | null;
  release_year: number | null;
  classified_type: string;
  genres: string[];
  count: number;
  is_favorited: boolean;
  rating: number;
  latest_played: string;
}

export interface AlbumsResponse {
  albums: AlbumListItem[];
  all_genres: string[];
  year_bounds: { min: number; max: number } | null;
}

export interface AlbumDetail {
  album_id: string;
  album_name: string;
  artist: string;
  art_filename: string | null;
  release_year: number | null;
  classified_type: string;
  count: number;
  is_favorited: boolean;
  rating: number;
  notes: string;
  genres: string[];
  track_plays: ArtistTrackPlay[];
}
