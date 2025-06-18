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
      console.log('----------------[apiDropdown onCreated] settings', settings);

      if (apiUrl && Meteor && Meteor.call) {
        console.log(`[apiDropdown] 서버 메서드 호출 시작: url=${apiUrl}, method=${method}`);
        Meteor.call('fetchApiDropdownData', apiUrl, method, (error, result) => {
          if (error) {
            console.error('[서버 API 호출 에러]', error);
          } else {
            console.log('[서버 API 호출 성공] result:', result);
            // API 응답이 3개 배열 구조면 트리로 변환
            if (result && result.Category && result.SecondCategory && result.ThirdCategory) {
              console.log('[API 응답 트리 구조 감지]');
              const tree = buildApiDropdownTree(result);
              self.optionsTree.set(tree);
              self.maxExistingDepth.set(2);
              console.log('[트리 구조 optionsTree]', tree);
            } else if (Array.isArray(result)) {
              // 기존 path 기반(flat array) 지원
              console.log('[API 응답 flat array 감지]', result);
              self.allOptions.set(result);
              const maxDepth = Math.max(...result.map(item => item.path.split('/').length - 1));
              self.maxExistingDepth.set(maxDepth);
              console.log('[flat array allOptions]', result, 'maxDepth:', maxDepth);
            } else {
              console.log('[API 응답 알 수 없음]', result);
            }
          }
        });
      }
    });
  }

  // 특정 depth의 옵션을 필터링하여 반환 (path 기반 flat array 전용)
  getFilteredOptions(depth) {
    const allOptions = this.allOptions.get() || [];
    const currentSelection = this.currentSelection.get() || {};

    // path가 없는 경우(트리형 구조)면 빈 배열 반환
    if (!allOptions.length || !allOptions[0].path) return [];

    // 상위 depth의 선택값과 일치하는 옵션만 필터링
    const filteredOptions = allOptions.filter(item => {
      const parts = item.path.split('/');
      for (let i = 0; i < depth; i++) {
        if (currentSelection[i] && parts[i] !== currentSelection[i]) {
          return false;
        }
      }
      return true;
    });

    // 현재 depth의 고유한 값만 추출 (빈 값 제외)
    const uniqueValues = new Set(
      filteredOptions
        .map(item => item.path.split('/')[depth])
        .filter(v => v !== undefined && v !== '')
    );

    return Array.from(uniqueValues).map(value => ({
      _id: value,
      name: value
    }));
  }

  // 트리 구조 기반 옵션 반환
  getItemsForDepth0() {
    const tree = this.optionsTree.get();
    if (tree && tree.length) {
      return tree.map(item => ({ _id: item.value, name: item.label }));
    }
    // fallback
    return this.getFilteredOptions(0);
  }
  getItemsForDepth1() {
    const tree = this.optionsTree.get();
    const currentSelection = this.currentSelection.get() || {};
    if (tree && tree.length && currentSelection[0]) {
      const parent = tree.find(item => item.value === currentSelection[0]);
      if (parent && parent.children) {
        return parent.children.map(item => ({ _id: item.value, name: item.label }));
      }
    }
    // fallback
    return this.getFilteredOptions(1);
  }
  getItemsForDepth2() {
    const tree = this.optionsTree.get();
    const currentSelection = this.currentSelection.get() || {};
    if (tree && tree.length && currentSelection[0] && currentSelection[1]) {
      const parent = tree.find(item => item.value === currentSelection[0]);
      if (parent && parent.children) {
        const child = parent.children.find(item => item.value === currentSelection[1]);
        if (child && child.children) {
          return child.children.map(item => ({ _id: item.value, name: item.label }));
        }
      }
    }
    // fallback
    return this.getFilteredOptions(2);
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

  getSelectedValues() {
    // selectedValues에 값이 있으면 그걸 반환
    const selected = this.selectedValues && this.selectedValues.get && this.selectedValues.get();
    if (selected && selected.length > 0) {
      return selected;
    }
    // selectedValues가 비어있고, 카드에 값이 있으면 그걸 반환
    const value = this.data().value;
    if (value) {
      return Array.isArray(value) ? value : [value];
    }
    return [];
  }

  hasSelectedValues() {
    const values = this.selectedValues.get() || [];
    return values.length > 0;
  }

  isSelected(id, depth) {
    const currentSelection = this.currentSelection.get() || {};
    return currentSelection[depth] === id;
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
      },
      // 저장된 값 클릭 시 currentSelection에 값 세팅 후 인라인 폼 열기 + 수정 인덱스 기억
      'click .selected-tag'(event) {
        event.preventDefault();
        const value = event.currentTarget.innerText;
        const parts = value.split('/');
        const currentSelection = {};
        parts.forEach((v, i) => { currentSelection[i] = v; });
        this.currentSelection.set(currentSelection);
        // 수정할 인덱스 기억
        const index = $(event.currentTarget).index();
        this.editIndex.set(index);
        if (this.openForm) this.openForm();
      },
      // 변경(덮어쓰기) 버튼 클릭 시 해당 인덱스 값만 교체
      'click .js-edit-value'(event) {
        event.preventDefault();
        const currentSelection = this.currentSelection.get() || {};
        const value = Object.values(currentSelection).join('/');
        const selectedValues = this.selectedValues.get() || [];
        const editIndex = this.editIndex.get();
        if (editIndex !== null && value) {
          selectedValues[editIndex] = value;
          this.selectedValues.set([...selectedValues]);
          this.card.setCustomField(this.customFieldId, [...selectedValues]);
          this.editIndex.set(null);
          this.currentSelection.set({});
          this.findAll('select').forEach(select => select.value = '');
        }
      },
      // 인라인 폼 열기 버튼 클릭 시
      'click .js-open-inlined-form'(event) {
        event.preventDefault();
        if (this.openForm) this.openForm();
      },
      // 인라인 폼 닫힐 때 수정 인덱스 초기화
      'click .js-close-inlined-form'(event) {
        if (this.editIndex) this.editIndex.set(null);
      },
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
