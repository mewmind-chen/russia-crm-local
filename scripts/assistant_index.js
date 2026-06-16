require('dotenv').config();

const { indexAssistantDocuments, getIndexStats } = require('../lib/assistant_index');

async function main() {
  const before = getIndexStats();
  console.log(`Assistant index before: documents=${before.documents}, embeddings=${before.embeddings}`);
  const result = await indexAssistantDocuments();
  console.log(`Assistant index complete: documents=${result.documents}, pending=${result.pending}, embedded=${result.embedded}`);
  console.log(`Embedding: provider=${result.provider}, model=${result.model}, dimensions=${result.dimensions}`);
  const after = getIndexStats();
  console.log(`Assistant index after: documents=${after.documents}, embeddings=${after.embeddings}`);
}

main().catch(err => {
  console.error(err.message || String(err));
  process.exit(1);
});
