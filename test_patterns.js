// Test script to verify pattern matching

// Copy the requiresLocalTools method logic for testing
function requiresLocalTools(message) {
  const lowerMessage = message.toLowerCase().trim();
  
  // Enhanced patterns that handle conversational context - ORDER MATTERS!
  const filePatterns = [
    // Pattern to catch "put [content] in [filename]" - check this first!
    /put\s+.+?\s+in\s+([^`"'\s]+(?:\.[^`"'\s]*)?)/i,
    // Pattern to catch "write tool" mentions
    /write\s+tool/i,
    /(?:write|save|create|put)\s+(?:to\s+)?(?:file|the file|a file)\s*[`"']?([^`"'\s]+)?[`"']?/i,
    /(?:write|create)\s+(?:a\s+)?(?:simple\s+)?(?:python\s+)?(?:server|script|file)/i,
    /create\s+(?:file|a file|new file)\s*[`"']?([^`"'\s]+)?[`"']?/i,
    /(?:edit|modify|change)\s+(?:file|the file|that file)\s*[`"']?([^`"'\s]+)?[`"']?/i,
    /(?:read|show|open|view)\s+(?:file|the file|that file)\s*[`"']?([^`"'\s]+)?[`"']?/i,
    /(?:list|show|display)\s+(?:files|directory|dir|folder)/i,
    /(?:delete|remove)\s+(?:file|the file|that file)\s*[`"']?([^`"'\s]+)?[`"']?/i,
  ];

  const commandPatterns = [
    /run\s+(?:command\s+)?[`"']?([^`"'\n]+)[`"']?/i,
    /execute\s+[`"']?([^`"'\n]+)[`"']?/i,
    /shell\s+[`"']?([^`"'\n]+)[`"']?/i,
    // Enhanced patterns for conversational context
    /(?:run|execute|start)\s+(?:it|that|this|the\s+(?:server|script|file|command))/i,
    /(?:proceed|continue|go\s+ahead)/i,
    /npm\s+/i,
    /git\s+/i,
    /ls\s/i,
    /pwd/i,
    /mkdir\s/i,
    /cd\s/i,
    /python\s+/i,
    /node\s+/i,
  ];

  const toolCalls = [];

  // Check for file operations - process only the first match to avoid duplicates
  for (const pattern of filePatterns) {
    const match = message.match(pattern);
    if (match) {
      // Check specific patterns first based on the pattern that matched
      if (pattern.source.includes('put\\s+.+?\\s+in')) {
        // "put X in filename" pattern
        toolCalls.push({
          name: 'write_file',
          args: { file_path: match[1] || 'new_file.txt', content: '' }
        });
      } else if (pattern.source.includes('write\\s+tool')) {
        // "write tool" pattern
        toolCalls.push({
          name: 'write_file',
          args: { file_path: 'example_file.txt', content: '' }
        });
      } else if (lowerMessage.includes('read') || lowerMessage.includes('show') || lowerMessage.includes('open') || lowerMessage.includes('view')) {
        toolCalls.push({
          name: 'read_file',
          args: { absolute_path: match[1] || '' }
        });
      } else if (lowerMessage.includes('write') || lowerMessage.includes('create') || lowerMessage.includes('save') || lowerMessage.includes('put')) {
        // Special handling for Python server creation
        if (lowerMessage.includes('python') && lowerMessage.includes('server')) {
          toolCalls.push({
            name: 'write_file',
            args: { file_path: 'server.py', content: '' }
          });
        } else {
          toolCalls.push({
            name: 'write_file',
            args: { file_path: match[1] || 'new_file.txt', content: '' }
          });
        }
      } else if (lowerMessage.includes('edit') || lowerMessage.includes('modify') || lowerMessage.includes('change')) {
        toolCalls.push({
          name: 'edit_file',
          args: { file_path: match[1] || '', old_string: '', new_string: '' }
        });
      } else if (lowerMessage.includes('list') || lowerMessage.includes('show') || lowerMessage.includes('display')) {
        toolCalls.push({
          name: 'list_directory',
          args: { path: '.' }
        });
      }
      break; // Only process the first matching pattern to avoid duplicates
    }
  }

  return { needsTools: toolCalls.length > 0, toolCalls };
}

// Test cases
const testCases = [
  "show me an example of using the write tool. put a dad joke in dad.txt",
  "create file hello.py",
  "write a simple python server to server.py",
  "run it",
  "proceed"
];

console.log("Testing pattern matching:");
testCases.forEach(testCase => {
  const result = requiresLocalTools(testCase);
  console.log(`\nInput: "${testCase}"`);
  console.log(`Needs tools: ${result.needsTools}`);
  console.log(`Tool calls: ${JSON.stringify(result.toolCalls, null, 2)}`);
});