import { extractProduct } from './extract.js';
import { fetchPage } from './fetch-page.js';

export async function getProduct(link, options) {
  const { html, url } = await fetchPage(link);
  return extractProduct(html, url, options);
}
