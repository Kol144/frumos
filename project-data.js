const makeId = () => Math.random().toString(36).slice(2, 10);

export function cleanProject(raw) {
  const project = { ...(raw || {}) };
  // Discard legacy sampler data while retaining all project and music fields.
  delete project.pads;
  delete project.rows;
  delete project.cols;
  const oldTheme = project.theme || {};
  const name = String(project.name || 'Mi proyecto');
  return {
    ...project,
    id: project.id || makeId(),
    name,
    saved: typeof project.saved === 'boolean' ? project.saved : name !== 'Mi primer proyecto',
    bpm: Math.max(20, Math.min(300, Number(project.bpm) || 120)),
    key: project.key || '',
    mode: project.mode || 'Mayor',
    note: project.note || '',
    theme: {
      bg: oldTheme.bg || '#101010',
      panel: oldTheme.panel || oldTheme.pad || '#1e1e1e',
      border: oldTheme.border || '#333333',
    },
    repertoire: Array.isArray(project.repertoire) ? project.repertoire.map((song) => ({
      id: song.id || makeId(),
      title: String(song.title || 'Sin título'),
      artist: String(song.artist || ''),
      lyrics: String(song.lyrics || ''),
      key: String(song.key || ''),
      bpm: Math.max(20, Math.min(300, Number(song.bpm) || Number(project.bpm) || 120)),
    })) : [],
    created: Number(project.created) || Date.now(),
  };
}

