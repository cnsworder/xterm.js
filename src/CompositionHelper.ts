/**
 * xterm.js: xterm, in the browser
 * Copyright (c) 2014-2016, SourceLair Private Company (www.sourcelair.com (MIT License)
 */

import { ITerminal } from './Interfaces';

interface IPosition {
  start: number;
  end: number;
}

/**
 * Encapsulates the logic for handling compositionstart, compositionupdate and compositionend
 * events, displaying the in-progress composition to the UI and forwarding the final composition
 * to the handler.
 */
export class CompositionHelper {
  /**
   * Whether input composition is currently happening, eg. via a mobile keyboard, speech input or
   * IME. This variable determines whether the compositionText should be displayed on the UI.
   */
  private isComposing: boolean;

  /**
   * The position within the input textarea's value of the current composition.
   */
  private compositionPosition: IPosition;;

  /**
   * Whether a composition is in the process of being sent, setting this to false will cancel any
   * in-progress composition.
   */
  private isSendingComposition: boolean;

  /**
   * Creates a new CompositionHelper.
   * @param textarea The textarea that xterm uses for input.
   * @param compositionView The element to display the in-progress composition in.
   * @param terminal The Terminal to forward the finished composition to.
   */
  constructor(
    private textarea: HTMLTextAreaElement,
    private compositionView: HTMLElement,
    private terminal: ITerminal
  ) {
    this.isComposing = false;
    this.isSendingComposition = false;
    this.compositionPosition = { start: null, end: null };
  }

  /**
   * Handles the compositionstart event, activating the composition view.
   */
  public compositionstart() {
    this.isComposing = true;
    this.compositionPosition.start = this.textarea.value.length;
    this.compositionView.textContent = '';
    this.compositionView.classList.add('active');
  }

  /**
   * Handles the compositionupdate event, updating the composition view.
   * @param {CompositionEvent} ev The event.
   */
  public compositionupdate(ev: CompositionEvent) {
    this.compositionView.textContent = ev.data;
    this.updateCompositionElements();
    var self = this;
    setTimeout(function() {
      self.compositionPosition.end = self.textarea.value.length;
    }, 0);
  }

  /**
   * Handles the compositionend event, hiding the composition view and sending the composition to
   * the handler.
   */
  public compositionend() {
    this.finalizeComposition(true);
  }

  /**
   * Handles the keydown event, routing any necessary events to the CompositionHelper functions.
   * @param ev The keydown event.
   * @return Whether the Terminal should continue processing the keydown event.
   */
  public keydown(ev: KeyboardEvent) {
    if (this.isComposing || this.isSendingComposition) {
      if (ev.keyCode === 229) {
        // Continue composing if the keyCode is the "composition character"
        return false;
      } else if (ev.keyCode === 16 || ev.keyCode === 17 || ev.keyCode === 18) {
        // Continue composing if the keyCode is a modifier key
        return false;
      } else {
        // Finish composition immediately. This is mainly here for the case where enter is
        // pressed and the handler needs to be triggered before the command is executed.
        this.finalizeComposition(false);
      }
    }

    if (ev.keyCode === 229) {
      // If the "composition character" is used but gets to this point it means a non-composition
      // character (eg. numbers and punctuation) was pressed when the IME was active.
      this.handleAnyTextareaChanges();
      return false;
    }

    return true;
  }

  /**
   * Finalizes the composition, resuming regular input actions. This is called when a composition
   * is ending.
   * @param waitForPropogation Whether to wait for events to propogate before sending
   *   the input. This should be false if a non-composition keystroke is entered before the
   *   compositionend event is triggered, such as enter, so that the composition is send before
   *   the command is executed.
   */
  private finalizeComposition(waitForPropogation: boolean) {
    this.compositionView.classList.remove('active');
    this.isComposing = false;
    this.clearTextareaPosition();

    if (!waitForPropogation) {
      // Cancel any delayed composition send requests and send the input immediately.
      this.isSendingComposition = false;
      var input = this.textarea.value.substring(this.compositionPosition.start, this.compositionPosition.end);
      this.terminal.handler(input);
    } else {
      // Make a deep copy of the composition position here as a new compositionstart event may
      // fire before the setTimeout executes.
      var currentCompositionPosition = {
        start: this.compositionPosition.start,
        end: this.compositionPosition.end,
      }

      // Since composition* events happen before the changes take place in the textarea on most
      // browsers, use a setTimeout with 0ms time to allow the native compositionend event to
      // complete. This ensures the correct character is retrieved, this solution was used
      // because:
      // - The compositionend event's data property is unreliable, at least on Chromium
      // - The last compositionupdate event's data property does not always accurately describe
      //   the character, a counter example being Korean where an ending consonsant can move to
      //   the following character if the following input is a vowel.
      var self = this;
      this.isSendingComposition = true;
      setTimeout(function () {
        // Ensure that the input has not already been sent
        if (self.isSendingComposition) {
          self.isSendingComposition = false;
          var input;
          if (self.isComposing) {
            // Use the end position to get the string if a new composition has started.
            input = self.textarea.value.substring(currentCompositionPosition.start, currentCompositionPosition.end);
          } else {
            // Don't use the end position here in order to pick up any characters after the
            // composition has finished, for example when typing a non-composition character
            // (eg. 2) after a composition character.
            input = self.textarea.value.substring(currentCompositionPosition.start);
          }
          self.terminal.handler(input);
        }
      }, 0);
    }
  }

  /**
   * Apply any changes made to the textarea after the current event chain is allowed to complete.
   * This should be called when not currently composing but a keydown event with the "composition
   * character" (229) is triggered, in order to allow non-composition text to be entered when an
   * IME is active.
   */
  private handleAnyTextareaChanges() {
    var oldValue = this.textarea.value;
    var self = this;
    setTimeout(function() {
      // Ignore if a composition has started since the timeout
      if (!self.isComposing) {
        var newValue = self.textarea.value;
        var diff = newValue.replace(oldValue, '');
        if (diff.length > 0) {
          self.terminal.handler(diff);
        }
      }
    }, 0);
  }

  /**
   * Positions the composition view on top of the cursor and the textarea just below it (so the
   * IME helper dialog is positioned correctly).
   * @param dontRecurse Whether to use setTimeout to recursively trigger another update, this is
   *   necessary as the IME events across browsers are not consistently triggered.
   */
  public updateCompositionElements(dontRecurse?: boolean) {
    if (!this.isComposing) {
      return;
    }
    var cursor = <HTMLElement>this.terminal.element.querySelector('.terminal-cursor');
    if (cursor) {
      // Take .xterm-rows offsetTop into account as well in case it's positioned absolutely within
      // the .xterm element.
      var xtermRows = <HTMLElement>this.terminal.element.querySelector('.xterm-rows');
      var cursorTop = xtermRows.offsetTop + cursor.offsetTop;

      this.compositionView.style.left = cursor.offsetLeft + 'px';
      this.compositionView.style.top = cursorTop + 'px';
      this.compositionView.style.height = cursor.offsetHeight + 'px';
      this.compositionView.style.lineHeight = cursor.offsetHeight + 'px';
      // Sync the textarea to the exact position of the composition view so the IME knows where the
      // text is.
      var compositionViewBounds = this.compositionView.getBoundingClientRect();
      this.textarea.style.left = cursor.offsetLeft + 'px';
      this.textarea.style.top = cursorTop + 'px';
      this.textarea.style.width = compositionViewBounds.width + 'px';
      this.textarea.style.height = compositionViewBounds.height + 'px';
      this.textarea.style.lineHeight = compositionViewBounds.height + 'px';
    }
    if (!dontRecurse) {
      setTimeout(this.updateCompositionElements.bind(this, true), 0);
    }
  };

  /**
   * Clears the textarea's position so that the cursor does not blink on IE.
   * @private
   */
  private clearTextareaPosition() {
    this.textarea.style.left = '';
    this.textarea.style.top = '';
  };
}
