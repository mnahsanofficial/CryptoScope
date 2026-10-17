import { parseHostSearch } from './host-search';

describe('parseHostSearch', () => {
  it.each([
    ['zeuz', { host: 'zeuz' }],
    ['qa.zeuz.ai', { host: 'qa.zeuz.ai' }],
    ['https://qa.zeuz.ai/', { host: 'qa.zeuz.ai' }],
    ['  HTTPS://QA.Zeuz.AI/login?next=/home#top ', { host: 'qa.zeuz.ai' }],
    ['http://qa.zeuz.ai', { host: 'qa.zeuz.ai' }],
    ['qa.zeuz.ai:8443', { host: 'qa.zeuz.ai', port: 8443 }],
    ['https://qa.zeuz.ai:443/', { host: 'qa.zeuz.ai', port: 443 }],
    ['qa.zeuz.ai:', { host: 'qa.zeuz.ai' }],
    ['https://', { host: '' }],
  ])('%p -> %o', (input, expected) => {
    expect(parseHostSearch(input)).toEqual(expected);
  });

  it('ignores an impossible port instead of filtering by it', () => {
    expect(parseHostSearch('example.com:99999')).toEqual({ host: 'example.com:99999' });
  });
});
