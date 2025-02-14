import * as ImageHandlers from './images';
import * as ClickHandlers from './clickHandlers';
import * as Overlay from './overlay';
import * as IndentHandlers from './indent';
import { RichMarkdownSettings } from './settings';

module.exports = {
	default: function(context) { 
		return {
			plugin: function(CodeMirror) {
				async function path_from_id(id: string) {
					return await context.postMessage({name:'getResourcePath', id: id});
				}
				async function get_settings() {
					return await context.postMessage({name: 'getSettings'});
				}

				function is_click_allowed(cm:any, event: MouseEvent) {
					const settings = cm.state.richMarkdown.settings;
					if (!settings.clickCtrl) return true;

					let allowed = false;
					if (settings.clickAlt) {
						allowed = allowed || event.altKey;
					}
					if (navigator.platform.toUpperCase().indexOf('MAC') >= 0) {
						allowed = allowed || event.metaKey;
					}
					else {
						allowed = allowed || event.ctrlKey;
					}

					return allowed;
				}

				CodeMirror.defineExtension('initializeRichMarkdown', function(settings: RichMarkdownSettings) {
					this.state.richMarkdown = {
						settings,
						path_from_id,
					};

					this.on('change', on_change);
					this.on('update', on_update);
					this.on('mousedown', on_mousedown);
					this.on('renderLine', on_renderLine);

					Overlay.add(this);
					IndentHandlers.calculateSpaceWidth(this);
					if (settings.inlineImages && settings.scanImgChangePeriod > 0) {
						this.state.richMarkdown.scanImgInterval = setInterval(ImageHandlers.refreshAllWidgets, settings.scanImgChangePeriod * 1000, this);
					}

					this.updateRichMarkdownSettings(settings);
				});

				CodeMirror.defineExtension('updateRichMarkdownSettings', function(newSettings: RichMarkdownSettings) {
					if (!this.state.richMarkdown) return;

					this.state.richMarkdown.settings = newSettings;
					ImageHandlers.clearAllWidgets(this);
					ImageHandlers.onSourceChanged(this, this.firstLine(), this.lastLine());
					ImageHandlers.afterSourceChanges(this);
					if (newSettings.activeLine) {
						this.setOption('styleActiveLine', { nonEmpty: true });
					} else {
						this.setOption('styleActiveLine', false);
					}
					this.getWrapperElement().onmousemove = on_mousemove(this, newSettings);
					this.getWrapperElement().onmouseup = on_mouseup(this, newSettings);
					if (this.state.richMarkdown.scanImgInterval) {
						clearInterval(this.state.richMarkdown.scanImgInterval)
					}
					if (newSettings.inlineImages && newSettings.scanImgChangePeriod > 0) {
						this.state.richMarkdown.scanImgInterval = setInterval(ImageHandlers.refreshAllWidgets, newSettings.scanImgChangePeriod * 1000, this);
					}
				});

				CodeMirror.defineExtension('clickUnderCursor', function() {
					const coord = this.getCursor('head');
					const mes = ClickHandlers.clickAt(this, coord);
					if (mes)
						context.postMessage(mes);
				});

				function on_renderLine(cm: any, line: any, element: HTMLElement) {
					IndentHandlers.onRenderLine(cm, line, element, CodeMirror);
				}

				function get_change_lines(change: any) {
					// change.from and change.to reflect the change location *before* the edit took place
					// when a larger scale edit happens they don't necessarily reflect the true scope of changes
					const from = change.from.line;
					let to = change.to.line;
					to -= change.removed.length;
					to += change.text.length;

					return { from, to };
				}

				function on_change(cm: any, change: any) {
					const { from, to } = get_change_lines(change);
					
					ImageHandlers.onSourceChanged(cm, from, to);
				}
				function on_update(cm: any) {
					ImageHandlers.afterSourceChanges(cm);
				}

				async function on_mousedown(cm: any, event: MouseEvent) {
					if (!cm.state.richMarkdown) return;

					const clickAllowed = is_click_allowed(cm, event);

					if (clickAllowed &&
						 (ClickHandlers.isLink(event) ||
							ClickHandlers.isCheckbox(event))) {
						const coord = ClickHandlers.getClickCoord(cm, event);
						const mes = ClickHandlers.clickAt(cm, coord);
						if (mes)
							context.postMessage(mes);

						event.preventDefault();
					}
				}

				function update_cursor(cm:any, settings: RichMarkdownSettings, event: MouseEvent) {
					if (!event.target) return;

					let cursor = '';

					if ((settings.links && ClickHandlers.isLink(event)) ||
						  (settings.checkbox && ClickHandlers.isCheckbox(event))) {
						cursor = is_click_allowed(cm, event) ? 'pointer' : cursor;
					}

					const target = event.target as HTMLElement;
					target.style.cursor = cursor;
				}

				function on_mousemove(cm:any, settings: RichMarkdownSettings) {
					return function(event: MouseEvent) {
						update_cursor(cm, settings, event);
					}
				}

				function on_mouseup(cm:any, settings: RichMarkdownSettings) {
					return function(event: MouseEvent) {
						update_cursor(cm, settings, event);
					}
				}

				CodeMirror.defineOption('enable-rich-mode', false, async function(cm, val, old) {
					// Cleanup
					if (old && old != CodeMirror.Init) {
						cm.off('change', on_change);
						cm.off('update', on_update);
						cm.off('mousedown', on_mousedown);
						cm.off('renderLine', on_renderLine);

						Overlay.remove(cm);
						cm.state.richMarkdown = null;
						ImageHandlers.clearAllWidgets(cm);
						clearInterval(this.state.richMarkdown.scanImgInterval)
					}
					// setup
					if (val) {
						// There is a race condition in the Joplin initialization code
						// Sometimes the settings aren't ready yet and will return `undefined`
						// This code will perform an exponential backoff and poll settings
						// until something is returned
						async function backoff(timeout: number) {
							const settings = await get_settings();

							if (!settings) {
								setTimeout(backoff, timeout * 2, timeout * 2);
							}
							else {
								cm.initializeRichMarkdown(settings);
							}
						};
						// Set the first timeout to 50 because settings are usually ready immediately
						// Set the first backoff to (100*2) to give a little extra time
						setTimeout(backoff, 50, 100);
					}
				});
			},
			codeMirrorResources: ['addon/selection/active-line', 'addon/selection/mark-selection'],
			codeMirrorOptions: { 'enable-rich-mode': true,
													 'styleSelectedText': true },
			assets: function() {
				return [
					{ mime: 'text/css',
						inline: true,
						text: `.cm-rm-monospace {
											font-family: monospace !important;
										}
										.cm-rm-ins {
											text-decoration: underline;
										}
										.cm-rm-sub {
											vertical-align: sub;
											font-size: smaller;
										}
										.cm-rm-sup {
											vertical-align: super;
											font-size: smaller;
										}
										.cm-rm-highlight {
											background-color: var(--joplin-search-marker-background-color);
											color: var(--joplin-search-marker-color);
										}
										.CodeMirror-selectedtext.cm-rm-highlight {
											background-color: #e5d3ce;
										}
										/* Needed for the renderLine indent hack to work */
										.CodeMirror pre > * { text-indent: 0px; }
							`
					}
				];
			},
		}
	},
}
