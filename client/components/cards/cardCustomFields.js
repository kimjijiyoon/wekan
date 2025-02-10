import moment from 'moment/min/moment-with-locales';
import { TAPi18n } from '/imports/i18n';
import { DatePicker } from '/client/lib/datepicker';
import Cards from '/models/cards';
import { CustomFieldStringTemplate } from '/client/lib/customFields'

Template.cardCustomFieldsPopup.helpers({
  hasCustomField() {
    const card = Utils.getCurrentCard();
    const customFieldId = this._id;
    return card.customFieldIndex(customFieldId) > -1;
  },
});

Template.cardCustomFieldsPopup.events({
  'click .js-select-field'(event) {
    const card = Utils.getCurrentCard();
    const customFieldId = this._id;
    card.toggleCustomField(customFieldId);
    event.preventDefault();
  },
  'click .js-settings'(event) {
    EscapeActions.executeUpTo('detailsPane');
    Sidebar.setView('customFields');
    event.preventDefault();
  },
});

// cardCustomField
const CardCustomField = BlazeComponent.extendComponent({
  getTemplate() {
    return `cardCustomField-${this.data().definition.type}`;
  },

  onCreated() {
    const self = this;
    self.card = Utils.getCurrentCard();
    self.customFieldId = this.data()._id;
  },
});
CardCustomField.register('cardCustomField');

// cardCustomField-text
(class extends CardCustomField {
  onCreated() {
    super.onCreated();
  }

  events() {
    return [
      {
        'submit .js-card-customfield-text'(event) {
          event.preventDefault();
          const value = this.currentComponent().getValue();
          this.card.setCustomField(this.customFieldId, value);
        },
      },
    ];
  }
}.register('cardCustomField-text'));

(class extends CardCustomField {
  onCreated() {
    console.log('[apiDropdown onCreated 시작]');
    super.onCreated();
    const self = this;
    self.allOptions = new ReactiveVar([]);
    self.selectedValues = new ReactiveVar([]);
    self.currentSelection = new ReactiveVar({}); // 현재 선택 중인 값
    self.maxExistingDepth = new ReactiveVar(0);  // 실제 존재하는 최대 depth 저장

    // 기존 값이 있으면 배열로 변환하여 설정
    const currentValue = this.data().value;
    if (currentValue) {
      self.selectedValues.set(Array.isArray(currentValue) ? currentValue : [currentValue]);
    }

    self.autorun(() => {
      const settings = self.data().definition.settings;
      const apiUrl = settings.apiUrl;
      const method = (settings.apiMethod || 'GET').toLowerCase();

      if (apiUrl && HTTP[method]) {
        try {
          HTTP[method](apiUrl, (error, result) => {
            if (error) {
              console.error('[API 호출 에러]', error);
            } else {
              console.log('[API 응답 데이터]', result.data);
              self.allOptions.set(result.data);

              // 실제 존재하는 최대 depth 계산
              const maxDepth = Math.max(...result.data.map(item =>
                item.path.split('/').length - 1
              ));
              console.log('[실제 최대 depth]', maxDepth);
              self.maxExistingDepth.set(maxDepth);
            }
          });
        } catch (err) {
          console.error('[HTTP 메서드 호출 에러]', err);
        }
      }
    });
  }

  // 특정 depth의 옵션을 필터링하여 반환
  getFilteredOptions(depth) {
    const allOptions = this.allOptions.get() || [];
    const currentSelection = this.currentSelection.get() || {};

    console.log(`[depth ${depth} 옵션 필터링]`, {
      currentSelection,
      allOptions
    });

    // 상위 depth의 선택값과 일치하는 옵션만 필터링
    const filteredOptions = allOptions.filter(item => {
      const parts = item.path.split('/');

      // 상위 depth의 모든 선택값과 일치하는지 확인
      for (let i = 0; i < depth; i++) {
        if (currentSelection[i] && parts[i] !== currentSelection[i]) {
          return false;
        }
      }
      return true;
    });

    // 현재 depth의 고유한 값만 추출
    const uniqueValues = new Set(
      filteredOptions.map(item => item.path.split('/')[depth])
    );

    console.log(`[depth ${depth} 필터링된 결과]`, Array.from(uniqueValues));

    return Array.from(uniqueValues).map(value => ({
      _id: value,
      name: value
    }));
  }

  getSelectedValues() {
    return this.selectedValues.get() || [];
  }

  hasSelectedValues() {
    const values = this.selectedValues.get() || [];
    return values.length > 0;
  }

  isSelected(id, depth) {
    const currentSelection = this.currentSelection.get() || {};
    return currentSelection[depth] === id;
  }

  getItemsForDepth0() {
    return this.getFilteredOptions(0);
  }
  getItemsForDepth1() {
    return this.maxExistingDepth.get() >= 1 ? this.getFilteredOptions(1) : [];
  }
  getItemsForDepth2() {
    return this.maxExistingDepth.get() >= 2 ? this.getFilteredOptions(2) : [];
  }
  showDepth1() {
    return this.maxExistingDepth.get() >= 1;
  }
  showDepth2() {
    return this.maxExistingDepth.get() >= 2;
  }
  isSelectedDepth0(id) {
    return this.isSelected(id, 0);
  }
  isSelectedDepth1(id) {
    return this.isSelected(id, 1);
  }
  isSelectedDepth2(id) {
    return this.isSelected(id, 2);
  }

  events() {
    return [{
      'change .js-depth-select'(event) {
        const depth = parseInt(event.currentTarget.dataset.depth);
        const value = event.currentTarget.value;
        const currentSelection = this.currentSelection.get() || {};

        console.log('[select 박스 변경]', { depth, value });

        if (value) {
          currentSelection[depth] = value;
          // 하위 depth의 선택값 초기화
          for (let i = depth + 1; i < 3; i++) {
            delete currentSelection[i];
          }
        } else {
          // 현재와 하위 depth의 선택값 모두 초기화
          for (let i = depth; i < 3; i++) {
            delete currentSelection[i];
          }
        }

        this.currentSelection.set(currentSelection);
        console.log('[업데이트된 선택값]', currentSelection);
      },

      'click .js-add-value'(event) {
        event.preventDefault();
        const currentSelection = this.currentSelection.get() || {};
        const values = Object.values(currentSelection).filter(Boolean);

        if (values.length > 0) {
          const newPath = values.join('/');
          const selectedValues = this.selectedValues.get() || [];

          if (!selectedValues.includes(newPath)) {
            this.selectedValues.set([...selectedValues, newPath]);
          }

          // 선택 초기화
          this.currentSelection.set({});
          this.findAll('select').forEach(select => select.value = '');
        }
      },

      'click .js-remove-value'(event) {
        const index = $(event.currentTarget).data('index');
        const selectedValues = this.selectedValues.get() || [];
        selectedValues.splice(index, 1);
        this.selectedValues.set([...selectedValues]);
      },

      'submit .js-card-customfield-apidropdown'(event) {
        event.preventDefault();
        const currentSelection = this.currentSelection.get() || {};
        const value = Object.values(currentSelection).join('/');
        console.log('[저장할 값]', value);
        let selectedValues = this.selectedValues.get() || [];

        if (value) {
          if (!selectedValues.includes(value)) {
            selectedValues = [...selectedValues, value];
            this.selectedValues.set(selectedValues);
          }
        }
        // 선택 초기화
        this.currentSelection.set({});
        this.findAll('select').forEach(select => select.value = '');
        // 최종 저장
        console.log('[저장한 값]', selectedValues);
        this.card.setCustomField(this.customFieldId, selectedValues);
      }
    }];
  }
}.register('cardCustomField-apiDropdown'));

// cardCustomField-number
(class extends CardCustomField {
  onCreated() {
    super.onCreated();
  }

  events() {
    return [
      {
        'submit .js-card-customfield-number'(event) {
          event.preventDefault();
          const value = parseInt(this.find('input').value, 10);
          this.card.setCustomField(this.customFieldId, value);
        },
      },
    ];
  }
}.register('cardCustomField-number'));

// cardCustomField-checkbox
(class extends CardCustomField {
  onCreated() {
    super.onCreated();
  }

  toggleItem() {
    this.card.setCustomField(this.customFieldId, !this.data().value);
  }

  events() {
    return [
      {
        'click .js-checklist-item .check-box-container': this.toggleItem,
      },
    ];
  }
}.register('cardCustomField-checkbox'));

// cardCustomField-currency
(class extends CardCustomField {
  onCreated() {
    super.onCreated();

    this.currencyCode = this.data().definition.settings.currencyCode;
  }

  formattedValue() {
    const locale = TAPi18n.getLanguage();

    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currencyCode,
    }).format(this.data().value);
  }

  events() {
    return [
      {
        'submit .js-card-customfield-currency'(event) {
          event.preventDefault();
          // To allow input separated by comma, the comma is replaced by a period.
          const value = Number(this.find('input').value.replace(/,/i, '.'), 10);
          this.card.setCustomField(this.customFieldId, value);
        },
      },
    ];
  }
}.register('cardCustomField-currency'));

// cardCustomField-date
(class extends CardCustomField {
  onCreated() {
    super.onCreated();
    const self = this;
    self.date = ReactiveVar();
    self.now = ReactiveVar(moment());
    window.setInterval(() => {
      self.now.set(moment());
    }, 60000);

    self.autorun(() => {
      self.date.set(moment(self.data().value));
    });
  }

  showWeek() {
    return this.date.get().week().toString();
  }

  showWeekOfYear() {
    return ReactiveCache.getCurrentUser().isShowWeekOfYear();
  }

  showDate() {
    // this will start working once mquandalle:moment
    // is updated to at least moment.js 2.10.5
    // until then, the date is displayed in the "L" format
    return this.date.get().calendar(null, {
      sameElse: 'llll',
    });
  }

  showISODate() {
    return this.date.get().toISOString();
  }

  classes() {
    if (
      this.date.get().isBefore(this.now.get(), 'minute') &&
      this.now.get().isBefore(this.data().value)
    ) {
      return 'current';
    }
    return '';
  }

  showTitle() {
    return `${TAPi18n.__('card-start-on')} ${this.date.get().format('LLLL')}`;
  }

  events() {
    return [
      {
        'click .js-edit-date': Popup.open('cardCustomField-date'),
      },
    ];
  }
}.register('cardCustomField-date'));

// cardCustomField-datePopup
(class extends DatePicker {
  onCreated() {
    super.onCreated();
    const self = this;
    self.card = Utils.getCurrentCard();
    self.customFieldId = this.data()._id;
    this.data().value && this.date.set(moment(this.data().value));
  }

  _storeDate(date) {
    this.card.setCustomField(this.customFieldId, date);
  }

  _deleteDate() {
    this.card.setCustomField(this.customFieldId, '');
  }
}.register('cardCustomField-datePopup'));

// cardCustomField-dropdown
(class extends CardCustomField {
  onCreated() {
    super.onCreated();
    this._items = this.data().definition.settings.dropdownItems;
    this.items = this._items.slice(0);
    this.items.unshift({
      _id: '',
      name: TAPi18n.__('custom-field-dropdown-none'),
    });
  }

  selectedItem() {
    const selected = this._items.find(item => {
      return item._id === this.data().value;
    });
    return selected
      ? selected.name
      : TAPi18n.__('custom-field-dropdown-unknown');
  }

  events() {
    return [
      {
        'submit .js-card-customfield-dropdown'(event) {
          event.preventDefault();
          const value = this.find('select').value;
          this.card.setCustomField(this.customFieldId, value);
        },
      },
    ];
  }
}.register('cardCustomField-dropdown'));

// cardCustomField-stringtemplate
class CardCustomFieldStringTemplate extends CardCustomField {
  onCreated() {
    super.onCreated();

    this.customField = new CustomFieldStringTemplate(this.data().definition);

    this.stringtemplateItems = new ReactiveVar(this.data().value ?? []);
  }

  formattedValue() {
    const ret = this.customField.getFormattedValue(this.data().value);
    return ret;
  }

  getItems() {
    return Array.from(this.findAll('input'))
      .map(input => input.value)
      .filter(value => !!value.trim());
  }

  events() {
    return [
      {
        'submit .js-card-customfield-stringtemplate'(event) {
          event.preventDefault();
          const items = this.stringtemplateItems.get();
          this.card.setCustomField(this.customFieldId, items);
        },

        'keydown .js-card-customfield-stringtemplate-item'(event) {
          if (event.keyCode === 13) {
            event.preventDefault();

            if (event.target.value.trim() || event.metaKey || event.ctrlKey) {
              const inputLast = this.find('input.last');

              let items = this.getItems();

              if (event.target === inputLast) {
                inputLast.value = '';
              } else if (event.target.nextSibling === inputLast) {
                inputLast.focus();
              } else {
                event.target.blur();

                const idx = Array.from(this.findAll('input')).indexOf(
                  event.target,
                );
                items.splice(idx + 1, 0, '');

                Tracker.afterFlush(() => {
                  const element = this.findAll('input')[idx + 1];
                  element.focus();
                  element.value = '';
                });
              }

              this.stringtemplateItems.set(items);
            }
            if (event.metaKey || event.ctrlKey) {
              this.find('button[type=submit]').click();
            }
          }
        },

        'blur .js-card-customfield-stringtemplate-item'(event) {
          if (
            !event.target.value.trim() ||
            event.target === this.find('input.last')
          ) {
            const items = this.getItems();
            this.stringtemplateItems.set(items);
            this.find('input.last').value = '';
          }
        },

        'click .js-close-inlined-form'(event) {
          this.stringtemplateItems.set(this.data().value ?? []);
        },
      },
    ];
  }
}
CardCustomFieldStringTemplate.register('cardCustomField-stringtemplate');
