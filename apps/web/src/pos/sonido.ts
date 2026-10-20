let contexto: AudioContext | null = null;

/** Pitido corto y grave (Web Audio, sin archivos) para "producto no encontrado". */
export function sonarError(): void {
  try {
    contexto ??= new AudioContext();
    const oscilador = contexto.createOscillator();
    const volumen = contexto.createGain();
    oscilador.type = 'square';
    oscilador.frequency.value = 220;
    volumen.gain.value = 0.1;
    oscilador.connect(volumen).connect(contexto.destination);
    oscilador.start();
    oscilador.stop(contexto.currentTime + 0.25);
  } catch {
    // Sin audio disponible: queda el aviso visible.
  }
}
