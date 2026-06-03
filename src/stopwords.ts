export const BASE_STOPWORDS = new Set([
  'the', 'this', 'that', 'with', 'from', 'were', 'been', 'have', 'has', 'had', 'was', 'for',
  'are', 'but', 'not', 'you', 'all', 'can', 'her', 'one', 'our', 'out', 'its', 'also', 'into',
  'more', 'some', 'such', 'than', 'them', 'then', 'only', 'when', 'will', 'each', 'make',
  'like', 'over', 'after', 'which', 'their', 'would', 'about', 'these', 'other', 'could',
  'being', 'first', 'using', 'where', 'while', 'there', 'should', 'still', 'does', 'both',
  'they', 'what',
]);

const TOPIC_EXTENSIONS = [
  'before', 'between', 'because', 'against', 'through', 'during', 'under',
  'until', 'upon', 'within', 'without', 'across', 'along', 'around', 'instead', 'rather',
  'now', 'new', 'old', 'just', 'very', 'much', 'most', 'many', 'few', 'any', 'every',
  'always', 'never', 'often', 'once', 'twice', 'here', 'how', 'who', 'why', 'whose',
  'add', 'added', 'adds', 'fix', 'fixed', 'fixes', 'use', 'used', 'uses', 'set', 'sets',
  'get', 'gets', 'got', 'run', 'runs', 'ran', 'put', 'puts', 'see', 'sees', 'saw',
  'made', 'making', 'doing', 'done', 'goes', 'going', 'went', 'comes', 'came', 'gave',
  'taken', 'took', 'taking', 'said', 'says', 'tell', 'told',
  'observation', 'observations', 'session', 'sessions', 'project', 'projects',
  'note', 'notes', 'code', 'file', 'files', 'function', 'functions', 'method', 'methods',
  'class', 'classes', 'module', 'modules', 'package', 'packages',
];

export const TOPIC_STOPWORDS = new Set([...BASE_STOPWORDS, ...TOPIC_EXTENSIONS]);
