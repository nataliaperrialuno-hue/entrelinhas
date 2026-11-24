import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';

interface SealCanvasProps {
  onUse: (blob: Blob) => void;
  onClear: () => void;
}

const SEAL_COLORS = [
  { value: '#2b2119', label: 'Preto' },
  { value: '#7c2d38', label: 'Vinho' },
  { value: '#a44763', label: 'Rosado' },
  { value: '#356b8c', label: 'Azul' },
  { value: '#5c6b32', label: 'Oliva' },
  { value: '#a46a1f', label: 'Âmbar' },
] as const;

const BRUSH_SIZES = [2, 5, 9] as const;
type BrushSize = (typeof BRUSH_SIZES)[number];
type Tool = 'brush' | 'eraser';

const CANVAS_WIDTH = 180;
const CANVAS_HEIGHT = 180;

export function SealCanvas({ onUse, onClear }: SealCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawingRef = useRef(false);
  const [color, setColor] = useState<string>(SEAL_COLORS[0].value);
  const [size, setSize] = useState<BrushSize>(5);
  const [tool, setTool] = useState<Tool>('brush');

  useEffect(() => {
    const canvas = canvasRef.current;
    contextRef.current = canvas === null ? null : canvas.getContext('2d');
  }, []);

  function pointerPosition(event: PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / (rect.width || canvas.width);
    const scaleY = canvas.height / (rect.height || canvas.height);
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function configureContext(context: CanvasRenderingContext2D): void {
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = color;
    context.lineWidth = tool === 'eraser' ? Math.max(size * 3, 12) : size;
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>): void {
    const context = contextRef.current;
    if (context === null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    configureContext(context);
    const point = pointerPosition(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    // Garante um ponto visível mesmo sem movimento do ponteiro.
    context.lineTo(point.x + 0.01, point.y);
    context.stroke();
    drawingRef.current = true;
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>): void {
    const context = contextRef.current;
    if (context === null || !drawingRef.current) return;
    const point = pointerPosition(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function handlePointerUp(): void {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    contextRef.current?.closePath();
  }

  function handleClear(): void {
    const canvas = canvasRef.current;
    const context = contextRef.current;
    if (canvas !== null && context !== null) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    onClear();
  }

  function handleUse(): void {
    const canvas = canvasRef.current;
    if (canvas === null || typeof canvas.toBlob !== 'function') return;
    canvas.toBlob((blob) => {
      if (blob !== null) onUse(blob);
    }, 'image/png');
  }

  return (
    <div className="seal-canvas-panel">
      <canvas
        ref={canvasRef}
        className="seal-canvas"
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        role="img"
        aria-label="Área de desenho do selo"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      <div className="seal-canvas__tools" role="group" aria-label="Ferramentas do selo">
        {SEAL_COLORS.map((option) => (
          <button
            className={`seal-swatch${color === option.value ? ' seal-swatch--selected' : ''}`}
            key={option.value}
            type="button"
            style={{ backgroundColor: option.value }}
            title={option.label}
            aria-label={`Cor ${option.label}`}
            aria-pressed={color === option.value}
            onClick={() => {
              setColor(option.value);
              setTool('brush');
            }}
          />
        ))}
      </div>

      <div className="seal-canvas__tools" role="group" aria-label="Espessura do pincel">
        {BRUSH_SIZES.map((option) => (
          <button
            className={`seal-size${size === option ? ' seal-size--selected' : ''}`}
            key={option}
            type="button"
            aria-label={`Pincel ${option}`}
            aria-pressed={size === option}
            onClick={() => setSize(option)}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="seal-canvas__actions">
        <button
          className="seal-action"
          type="button"
          aria-label="Borracha"
          aria-pressed={tool === 'eraser'}
          onClick={() => setTool('eraser')}
        >
          Borracha
        </button>
        <button
          className="seal-action"
          type="button"
          aria-label="Pincel"
          aria-pressed={tool === 'brush'}
          onClick={() => setTool('brush')}
        >
          Pincel
        </button>
        <button className="seal-action" type="button" onClick={handleClear}>
          Limpar
        </button>
        <button className="seal-action seal-action--primary" type="button" onClick={handleUse}>
          Usar desenho
        </button>
      </div>
    </div>
  );
}

export default SealCanvas;
