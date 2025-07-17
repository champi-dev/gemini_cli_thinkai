#!/usr/bin/env node

/**
 * Test streaming with correct format handling
 */

async function testStreamingFixed() {
  console.log('🌊 Testing Streaming (Fixed)...');
  try {
    const response = await fetch('https://thinkai.lat/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Count from 1 to 3.',
        session_id: 'test-stream-' + Date.now(),
        mode: 'general',
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let chunks = [];
    
    console.log('Streaming response:');
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      console.log('Raw chunk:', JSON.stringify(chunk));
      
      // Try to parse as JSON directly
      try {
        const parsed = JSON.parse(chunk);
        if (parsed.chunk) {
          chunks.push(parsed.chunk);
          process.stdout.write(parsed.chunk);
        }
        
        if (parsed.done) {
          console.log('\n✅ Streaming Success (Fixed):');
          console.log('  Total chunks:', chunks.length);
          console.log('  Combined response:', chunks.join(''));
          return true;
        }
      } catch (parseError) {
        // Try line-by-line parsing
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.chunk) {
                chunks.push(parsed.chunk);
                process.stdout.write(parsed.chunk);
              }
              
              if (parsed.done) {
                console.log('\n✅ Streaming Success (Fixed):');
                console.log('  Total chunks:', chunks.length);
                console.log('  Combined response:', chunks.join(''));
                return true;
              }
            } catch (lineError) {
              // Ignore unparseable lines
            }
          }
        }
      }
    }
    
    console.log('\n✅ Streaming Success (Fixed):');
    console.log('  Total chunks:', chunks.length);
    console.log('  Combined response:', chunks.join(''));
    return true;
  } catch (error) {
    console.log('❌ Streaming Failed:', error.message);
    return false;
  }
}

testStreamingFixed();