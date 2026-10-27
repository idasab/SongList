import type { CSSProperties } from 'react';
import { Check, Eraser, Eye, EyeOff, Hand, PenLine, StickyNote as NoteIcon, Trash, Type, Undo2 } from 'lucide-react';
import {
  INK_COLORS,
  INK_WIDTHS,
  NOTE_COLORS,
  NOTE_LIMITS,
  clamp,
  type InkColor,
  type NoteColor,
  type StickyNote,
} from '../lib/annotations';
import type { AnnotTool } from '../hooks/useAnnotationGestures';

const TOOLS: { value: AnnotTool; label: string; Icon: typeof Hand }[] = [
  { value: 'move', label: 'Flytta och scrolla', Icon: Hand },
  { value: 'pen', label: 'Penna', Icon: PenLine },
  { value: 'eraser', label: 'Sudd', Icon: Eraser },
  { value: 'note', label: 'Ny lapp', Icon: NoteIcon },
];

const INK_NAMES: Record<InkColor, string> = { ink: 'Svart', red: 'Röd', blue: 'Blå', green: 'Grön' };
const NOTE_NAMES: Record<NoteColor, string> = { yellow: 'Gul', pink: 'Rosa', green: 'Grön', blue: 'Blå' };
const WIDTH_NAMES = ['Tunn', 'Mellan', 'Tjock'];

export function AnnotationToolbar(props: {
  tool: AnnotTool;
  setTool: (t: AnnotTool) => void;
  inkColor: InkColor;
  setInkColor: (c: InkColor) => void;
  inkWidth: number;
  setInkWidth: (w: number) => void;
  canUndo: boolean;
  onUndo: () => void;
  visible: boolean;
  onToggleVisible: () => void;
  onClear: () => void;
  onDone: () => void;
  note: StickyNote | null;
  onNoteChange: (patch: Partial<StickyNote>) => void;
  onNoteDelete: () => void;
  onNoteEdit: () => void;
  /** I en setlista: om man ritar i setlistans lager eller på låten (överallt) */
  scope?: { inSetlist: boolean; onToggle: () => void };
  style?: CSSProperties;
}) {
  const { note } = props;
  return (
    <div className="song-toolbar annot-toolbar" style={props.style}>
      {/* Först, så att man alltid ser vilket lager man ritar i */}
      {props.scope && (
        <button
          className={`btn small scope-btn${props.scope.inSetlist ? ' active' : ''}`}
          title={props.scope.inSetlist ? 'Du ritar i setlistans lager (syns bara i den här setlistan)' : 'Du ritar på låten (syns överallt)'}
          onClick={props.scope.onToggle}
        >
          {props.scope.inSetlist ? 'I setlistan' : 'Överallt'}
        </button>
      )}

      <div className="tool-group">
        {TOOLS.map(({ value, label, Icon }) => (
          <button
            key={value}
            className={`btn icon${props.tool === value ? ' active' : ''}`}
            aria-label={label}
            title={label}
            aria-pressed={props.tool === value}
            onClick={() => props.setTool(value)}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>

      {note ? (
        <>
          <div className="tool-group" title="Lappens textstorlek">
            <button
              className="btn icon"
              aria-label="Mindre text på lappen"
              onClick={() => props.onNoteChange({ fontSize: clamp(round1(note.fontSize - 0.1), NOTE_LIMITS.minFont, NOTE_LIMITS.maxFont) })}
            >
              <Type size={13} />
            </button>
            <button
              className="btn icon"
              aria-label="Större text på lappen"
              onClick={() => props.onNoteChange({ fontSize: clamp(round1(note.fontSize + 0.1), NOTE_LIMITS.minFont, NOTE_LIMITS.maxFont) })}
            >
              <Type size={20} />
            </button>
          </div>
          <div className="tool-group" title="Lappens färg">
            {(Object.keys(NOTE_COLORS) as NoteColor[]).map((c) => (
              <button
                key={c}
                className={`btn icon swatch-btn${note.color === c ? ' active' : ''}`}
                aria-label={`${NOTE_NAMES[c]} lapp`}
                onClick={() => props.onNoteChange({ color: c })}
              >
                <span className="swatch note-swatch" style={{ background: NOTE_COLORS[c] }} />
              </button>
            ))}
          </div>
          <div className="tool-group">
            <button className="btn small" onClick={props.onNoteEdit}>
              Skriv
            </button>
            <button className="btn icon danger" aria-label="Ta bort lappen" title="Ta bort lappen" onClick={props.onNoteDelete}>
              <Trash size={17} />
            </button>
          </div>
        </>
      ) : (
        (props.tool === 'pen' || props.tool === 'eraser') && (
          <>
            <div className="tool-group" title="Pennans färg">
              {(Object.keys(INK_COLORS) as InkColor[]).map((c) => (
                <button
                  key={c}
                  className={`btn icon swatch-btn${props.inkColor === c ? ' active' : ''}`}
                  aria-label={`${INK_NAMES[c]} penna`}
                  onClick={() => {
                    props.setInkColor(c);
                    props.setTool('pen');
                  }}
                >
                  <span className="swatch" style={{ background: INK_COLORS[c] }} />
                </button>
              ))}
            </div>
            <div className="tool-group" title="Pennans tjocklek">
              {INK_WIDTHS.map((w, i) => (
                <button
                  key={w}
                  className={`btn icon swatch-btn${props.inkWidth === w ? ' active' : ''}`}
                  aria-label={`${WIDTH_NAMES[i]} penna`}
                  onClick={() => {
                    props.setInkWidth(w);
                    props.setTool('pen');
                  }}
                >
                  <span className="width-dot" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
                </button>
              ))}
            </div>
          </>
        )
      )}

      <div className="tool-group">
        <button className="btn icon" aria-label="Ångra" title="Ångra" disabled={!props.canUndo} onClick={props.onUndo}>
          <Undo2 size={18} />
        </button>
        <button
          className="btn icon"
          aria-label={props.visible ? 'Dölj anteckningar' : 'Visa anteckningar'}
          title={props.visible ? 'Dölj anteckningar' : 'Visa anteckningar'}
          onClick={props.onToggleVisible}
        >
          {props.visible ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
        <button className="btn icon danger" aria-label="Radera alla anteckningar" title="Radera alla anteckningar" onClick={props.onClear}>
          <Trash size={17} />
        </button>
      </div>

      <button className="btn primary small" onClick={props.onDone}>
        <Check size={16} /> Klar
      </button>
    </div>
  );
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
