'use client';

import { useEffect } from 'react';

/**
 * The page is the shell only — the same elements the diagram has always been
 * built into. React renders them once and never touches them again; the canvas
 * itself is `js/app.js`, imported after mount so the module finds the DOM it
 * expects. Nothing about the diagram's behaviour lives here.
 */
export default function Page() {
  useEffect(() => {
    /* Imported here, not at the top of the file: the module reads the DOM and
       starts drawing as soon as it is evaluated, so it must not run while the
       page is being rendered on the server. ES modules evaluate once, so a
       second run of this effect is a no-op. */
    import('../js/app.js');
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="topbar__lead">
          <h1>
            Zydus SEZ-1 <span>· SLD</span>
          </h1>
          <span className="chip" id="nodeCount"></span>
        </div>

        <div className="topbar__search">
          <svg className="search__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M10.5 10.5 14 14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            id="search"
            type="text"
            placeholder="Search energy meters…"
            autoComplete="off"
            spellCheck="false"
            role="combobox"
            aria-expanded="false"
            aria-autocomplete="list"
            aria-controls="searchResults"
          />
          <button
            id="searchClear"
            className="search__clear"
            type="button"
            aria-label="Clear search"
            hidden
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 4 12 12M12 4 4 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <ul
            id="searchResults"
            className="results"
            role="listbox"
            aria-label="Matching meters"
            hidden
          ></ul>
        </div>

        <div className="topbar__tools">
          <button id="expandAll" type="button" aria-label="Expand all">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M10 2h4v4M14 2 9 7M6 14H2v-4M2 14l5-5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Expand all</span>
          </button>
          <button id="collapseAll" type="button" aria-label="Collapse all">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M14 6h-4V2M14 2 9 7M2 10h4v4M2 14l5-5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Collapse all</span>
          </button>
          <span className="sep"></span>
          <button id="fit" type="button" aria-label="Fit to view">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Fit</span>
          </button>
          <span className="sep"></span>
          <button id="zoomOut" type="button" aria-label="Zoom out">
            &minus;
          </button>
          <span id="zoomLevel">100%</span>
          <button id="zoomIn" type="button" aria-label="Zoom in">
            +
          </button>
        </div>
      </header>

      <div id="viewport">
        <div id="world">
          <svg id="wires" aria-hidden="true"></svg>
        </div>

        <ul className="legend" aria-label="Meter status legend">
          <li className="legend__item" style={{ '--legend-color': '#d92d20' }}>
            <span className="legend__dot" aria-hidden="true"></span>Off
          </li>
          <li className="legend__item" style={{ '--legend-color': '#a0a0a0' }}>
            <span className="legend__dot" aria-hidden="true"></span>Disconnected
          </li>
        </ul>
      </div>

      <p className="hint">
        Drag to pan · scroll to pan · <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + scroll or pinch to zoom · click
        a chevron to expand or collapse
      </p>

      <div id="measure" aria-hidden="true"></div>
    </>
  );
}
