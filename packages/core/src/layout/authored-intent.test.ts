import { describe, expect, it } from 'vitest';
import {
  countTracks,
  describeTrackPattern,
  expandTracks,
  parseTrackList,
  parseTrackSize,
  recoverAuthoredIntent,
} from './authored-intent.js';

describe('parseTrackSize', () => {
  it('classifies the sizing functions that carry meaning', () => {
    expect(parseTrackSize('300px')).toEqual({ kind: 'fixed', raw: '300px', px: 300 });
    expect(parseTrackSize('1fr')).toEqual({ kind: 'flex', raw: '1fr', fr: 1 });
    expect(parseTrackSize('2.5fr')).toEqual({ kind: 'flex', raw: '2.5fr', fr: 2.5 });
    expect(parseTrackSize('auto')).toEqual({ kind: 'auto', raw: 'auto' });
    expect(parseTrackSize('min-content')).toEqual({ kind: 'min-content', raw: 'min-content' });
  });

  it('keeps percentages as fixed but admits it cannot resolve them', () => {
    expect(parseTrackSize('25%')).toEqual({ kind: 'fixed', raw: '25%', px: null });
  });

  it('parses minmax and fit-content', () => {
    const minmax = parseTrackSize('minmax(240px, 1fr)');
    expect(minmax.kind).toBe('minmax');
    if (minmax.kind === 'minmax') {
      expect(minmax.min).toEqual({ kind: 'fixed', raw: '240px', px: 240 });
      expect(minmax.max).toEqual({ kind: 'flex', raw: '1fr', fr: 1 });
    }
    expect(parseTrackSize('fit-content(300px)')).toEqual({
      kind: 'fit-content',
      raw: 'fit-content(300px)',
      limit: '300px',
    });
  });

  it('keeps syntax it does not understand rather than dropping it', () => {
    expect(parseTrackSize('min(100%, 240px)')).toEqual({
      kind: 'other',
      raw: 'min(100%, 240px)',
    });
  });
});

describe('parseTrackList', () => {
  it('reads a used value as a run of fixed tracks', () => {
    const list = parseTrackList('300px 300px 300px');
    expect(list.tracks).toHaveLength(3);
    expect(countTracks(list)).toBe(3);
  });

  it('treats none and an empty value as no tracks', () => {
    expect(parseTrackList('none').keyword).toBe('none');
    expect(parseTrackList('').keyword).toBe('none');
    expect(parseTrackList(null).tracks).toEqual([]);
  });

  it('keeps repeat() as a single entry and records its count', () => {
    const list = parseTrackList('repeat(auto-fit, minmax(240px, 1fr))');
    expect(list.tracks).toHaveLength(1);
    const [only] = list.tracks;
    expect(only?.kind).toBe('repeat');
    if (only?.kind === 'repeat') expect(only.count).toBe('auto-fit');
  });

  it('captures named grid lines with the track they precede', () => {
    const list = parseTrackList(
      '[full-start] minmax(1rem, 1fr) [content-start] 60ch [content-end] minmax(1rem, 1fr) [full-end]',
    );
    expect(list.tracks).toHaveLength(3);
    expect(list.lineNames).toEqual([
      { before: 0, names: ['full-start'] },
      { before: 1, names: ['content-start'] },
      { before: 2, names: ['content-end'] },
      { before: 3, names: ['full-end'] },
    ]);
  });

  it('groups multi-name line definitions', () => {
    const list = parseTrackList('200px [sidebar-end main-start] 1fr');
    expect(list.lineNames).toEqual([{ before: 1, names: ['sidebar-end', 'main-start'] }]);
  });

  it('flags subgrid instead of inventing tracks for it', () => {
    const list = parseTrackList('subgrid [a] [b]');
    expect(list.keyword).toBe('subgrid');
    expect(list.tracks).toEqual([]);
  });
});

describe('expandTracks / countTracks', () => {
  it('expands numeric repeats, including multi-track ones', () => {
    expect(countTracks(parseTrackList('repeat(3, 1fr)'))).toBe(3);
    expect(countTracks(parseTrackList('repeat(3, 1fr 2fr)'))).toBe(6);
    expect(countTracks(parseTrackList('200px repeat(2, 1fr) 100px'))).toBe(4);
  });

  it('refuses to guess a count for auto-fit', () => {
    expect(expandTracks(parseTrackList('repeat(auto-fill, 200px)'))).toBeNull();
    expect(countTracks(parseTrackList('repeat(auto-fit, minmax(240px, 1fr))'))).toBeNull();
  });
});

describe('describeTrackPattern', () => {
  it('describes uniform tracks as an equal split', () => {
    expect(describeTrackPattern(parseTrackList('300px 300px 300px'))).toBe('3 equal columns');
    expect(describeTrackPattern(parseTrackList('1fr 1fr'), 'rows')).toBe('2 equal rows');
  });

  it('lists mixed tracks in words', () => {
    expect(describeTrackPattern(parseTrackList('240px 1fr'))).toBe(
      '2 columns: 240px and flexible',
    );
    expect(describeTrackPattern(parseTrackList('200px 1fr 2fr'))).toBe(
      '3 columns: 200px, flexible and flexible (2fr)',
    );
  });

  it('uses the singular for a single track', () => {
    expect(describeTrackPattern(parseTrackList('300px'))).toBe('1 column: 300px');
  });

  it('describes an auto-repeat as the responsive idiom it is', () => {
    expect(describeTrackPattern(parseTrackList('repeat(auto-fit, minmax(240px, 1fr))'))).toBe(
      'as many columns as fit, each 240px to flexible',
    );
    expect(describeTrackPattern(parseTrackList('repeat(auto-fill, 200px)'))).toBe(
      'as many columns as fill, each 200px',
    );
  });

  it('says so when there are no explicit tracks', () => {
    expect(describeTrackPattern(parseTrackList('none'))).toBe('no explicit columns');
    expect(describeTrackPattern(parseTrackList('subgrid'), 'rows')).toBe(
      'subgrid — rows come from the parent grid',
    );
  });
});

describe('recoverAuthoredIntent', () => {
  it('recovers the responsive intent computed values throw away', () => {
    const intent = recoverAuthoredIntent({
      computed: '300px 300px 300px',
      authored: 'repeat(auto-fit, minmax(240px, 1fr))',
    });

    expect(intent.confidence).toBe('authored');
    expect(intent.explanation).toBe(
      '3 columns from repeat(auto-fit, minmax(240px, 1fr)) — currently 300px each',
    );
    expect(intent.pattern).toEqual({
      kind: 'auto-repeat',
      mode: 'auto-fit',
      min: '240px',
      max: '1fr',
    });
    expect(intent.note).toBe('the track count changes with the container width');
  });

  it('lists differing used sizes instead of claiming uniformity', () => {
    const intent = recoverAuthoredIntent({
      computed: '240px 660px',
      authored: '240px 1fr',
    });

    expect(intent.explanation).toBe('2 columns from 240px 1fr — currently 240px and 660px');
    expect(intent.pattern).toEqual({ kind: 'explicit' });
    expect(intent.note).toBeNull();
  });

  it('recognises a fixed repeat', () => {
    const intent = recoverAuthoredIntent({
      computed: '100px 100px 100px',
      authored: 'repeat(3, 1fr)',
    });

    expect(intent.pattern).toEqual({ kind: 'fixed-repeat', count: 3, track: '1fr' });
    expect(intent.explanation).toBe('3 columns from repeat(3, 1fr) — currently 100px each');
  });

  it('flags a declaration that cannot explain the used value', () => {
    // The classic case: a media query later in the cascade replaced the value.
    const intent = recoverAuthoredIntent({
      computed: '150px 150px 150px 150px',
      authored: 'repeat(2, 1fr)',
    });

    expect(intent.note).toContain('asks for 2 columns but layout resolved 4');
    expect(intent.note).toContain('media query');
  });

  it('falls back to the observed pattern, and says that is what it did', () => {
    const intent = recoverAuthoredIntent({ computed: '300px 300px 300px' });

    expect(intent.confidence).toBe('observed');
    expect(intent.explanation).toBe('3 equal columns, 300px each');
    expect(intent.note).toContain('authored declaration was not available');
    expect(intent.pattern).toEqual({ kind: 'unknown' });
  });

  it('describes an uneven observed pattern without inventing intent', () => {
    const intent = recoverAuthoredIntent({ computed: '240px 660px' });
    expect(intent.explanation).toBe('2 columns: 240px and 660px');
  });

  it('reports no explicit tracks as unknown rather than as a one-column grid', () => {
    const intent = recoverAuthoredIntent({ computed: 'none' });

    expect(intent.confidence).toBe('unknown');
    expect(intent.explanation).toContain('no explicit columns');
    expect(intent.pattern).toEqual({ kind: 'none' });
  });

  it('handles an authored value whose tracks have not resolved yet', () => {
    const intent = recoverAuthoredIntent({
      computed: 'none',
      authored: 'repeat(auto-fit, minmax(240px, 1fr))',
    });

    expect(intent.confidence).toBe('authored');
    expect(intent.explanation).toContain('no tracks are resolved right now');
  });

  it('uses row wording on the row axis', () => {
    const intent = recoverAuthoredIntent({
      computed: '80px 80px',
      authored: 'repeat(2, 80px)',
      axis: 'rows',
    });
    expect(intent.explanation).toBe('2 rows from repeat(2, 80px) — currently 80px each');
  });

  it('treats a blank authored string as no authored value', () => {
    const intent = recoverAuthoredIntent({ computed: '300px', authored: '   ' });
    expect(intent.confidence).toBe('observed');
  });
});
