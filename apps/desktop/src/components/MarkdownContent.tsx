import ReactMarkdown from 'react-markdown';
import type { ComponentProps, MouseEvent } from 'react';
import remarkGfm from 'remark-gfm';
import { tauriOpenExternal } from "../utils/platform";

type MarkdownComponents = NonNullable<ComponentProps<typeof ReactMarkdown>['components']>;

interface MarkdownContentProps {
  children: string;
}

const REPO_BASE_URL = 'https://github.com/mmdctjj/AudioDock/';

const toExternalUrl = (url?: string) => {
  if (!url) return '';

  try {
    if (/^(mailto:|tel:)/i.test(url)) return url;
    return new URL(url, REPO_BASE_URL).toString();
  } catch {
    return url;
  }
};

const openInDefaultBrowser = (url?: string) => {
  const externalUrl = toExternalUrl(url);
  if (!externalUrl) return;

  // Tauri 走 Rust open_url 命令，web 走 window.open（内部已做分流）
  void tauriOpenExternal(externalUrl);
};

const getDownloadFileName = (src?: string, alt?: string) => {
  if (alt?.trim()) return alt.trim();

  try {
    const { pathname } = new URL(toExternalUrl(src));
    const fileName = pathname.split('/').filter(Boolean).pop();
    if (fileName) return decodeURIComponent(fileName);
  } catch {
    // Fall through to the default filename.
  }

  return 'markdown-image';
};

const downloadImage = (src?: string, alt?: string) => {
  const imageUrl = toExternalUrl(src);
  if (!imageUrl) return;

  const anchor = document.createElement('a');
  anchor.href = imageUrl;
  anchor.download = getDownloadFileName(src, alt);
  anchor.rel = 'noopener noreferrer';
  anchor.target = '_blank';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
};

const markdownComponents: MarkdownComponents = {
  a: ({ href, children, ...props }) => {
    const externalUrl = toExternalUrl(href);

    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      openInDefaultBrowser(externalUrl);
    };

    return (
      <a
        {...props}
        href={externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const imageUrl = toExternalUrl(src);

    if (!imageUrl) return null;

    return (
      <figure style={{ margin: '12px 0' }}>
        <img
          src={imageUrl}
          alt={alt ?? ''}
          style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }}
        />
        <figcaption style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 13 }}>
          <button type="button" onClick={() => openInDefaultBrowser(imageUrl)}>
            打开图片
          </button>
          <button type="button" onClick={() => downloadImage(imageUrl, alt)}>
            下载图片
          </button>
        </figcaption>
      </figure>
    );
  },
};

const MarkdownContent = ({ children }: MarkdownContentProps) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={markdownComponents}
  >
    {children}
  </ReactMarkdown>
);

export default MarkdownContent;
