class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    
    if (input && input[0]) {
      // Add samples to buffer
      for (let i = 0; i < input[0].length; i++) {
        this.buffer.push(input[0][i]);
      }
      
      // When buffer is full, send it
      while (this.buffer.length >= this.bufferSize) {
        const chunk = this.buffer.slice(0, this.bufferSize);
        this.buffer = this.buffer.slice(this.bufferSize);
        
        // Send the audio data to the main thread
        this.port.postMessage({
          type: 'audio',
          data: new Float32Array(chunk)
        });
      }
    }
    
    return true; // Keep processor alive
  }
}

registerProcessor('audio-processor', AudioProcessor);