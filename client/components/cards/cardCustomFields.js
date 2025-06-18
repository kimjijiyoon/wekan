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

// === [apiDropdown 트리 변환 함수: 전역 선언] ===
function buildApiDropdownTree(apiData) {
  if (!apiData.Category || !apiData.SecondCategory || !apiData.ThirdCategory) return [];
  // 1차 카테고리
  const categories = apiData.Category.map(cat => ({
    value: cat.CODE,
    label: cat.name,
    children: []
  }));
  // 2차 카테고리 연결
  apiData.SecondCategory.forEach(sec => {
    const parent = categories.find(cat => cat.value === sec.CategoryCd);
    if (parent) {
      parent.children.push({
        value: sec.CODE,
        label: sec.name,
        children: []
      });
    }
  });
  // 3차 카테고리 연결
  apiData.ThirdCategory.forEach(third => {
    const parentCat = categories.find(cat => cat.value === third.CategoryCd);
    if (parentCat) {
      const parentSec = parentCat.children.find(sec => sec.value === third.SecondCategoryCd);
      if (parentSec) {
        parentSec.children.push({
          value: third.CODE,
          label: third.name
        });
      }
    }
  });
  return categories;
}

// cardCustomField
const CardCustomField = BlazeComponent.extendComponent({
  getTemplate() {
    console.log('[CardCustomField getTemplate]', this.data());
    return `cardCustomField-${this.data().definition.type}`;
  },

  onCreated() {
    console.log('[CardCustomField onCreated]');
    const self = this;
    self.card = Utils.getCurrentCard();
    self.customFieldId = this.data()._id;
    console.log('[CardCustomField 초기화 완료]', {
      card: self.card,
      customFieldId: self.customFieldId
    });
    self.editIndex = new ReactiveVar(null); // 수정 중인 값의 인덱스
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

console.log('[cardCustomFields.js 파일 로드됨]');

// cardCustomField-apiDropdown
(class extends CardCustomField {
  onCreated() {
    console.log('[apiDropdown onCreated 시작]');
    super.onCreated();
    const self = this;
    self.allOptions = new ReactiveVar([]);
    self.selectedValues = new ReactiveVar([]);
    self.currentSelection = new ReactiveVar({}); // 현재 선택 중인 값
    self.maxExistingDepth = new ReactiveVar(0);  // 실제 존재하는 최대 depth 저장
    self.optionsTree = new ReactiveVar([]); // 트리 구조 옵션
    self.apiLoaded = new ReactiveVar(false); // 최초 1회만 호출 플래그

    // 기존 값이 있으면 배열로 변환하여 설정
    const currentValue = this.data().value;
    if (currentValue) {
      self.selectedValues.set(Array.isArray(currentValue) ? currentValue : [currentValue]);
    }

    self.loadApiOptions = () => {
      if (self.apiLoaded.get()) return;
      self.apiLoaded.set(true);
      const settings = self.data().definition.settings;
      // 외부 API 호출 대신 DB에 저장된 옵션 사용
      const optionsData = settings.apiDropdownOptions;
      if (optionsData && optionsData.Category && optionsData.SecondCategory && optionsData.ThirdCategory) {
        console.log('[DB 옵션 트리 구조 감지]');
        const tree = buildApiDropdownTree(optionsData);
        self.optionsTree.set(tree);
        self.maxExistingDepth.set(2);
        console.log('[트리 구조 optionsTree]', tree);
      } else if (Array.isArray(optionsData)) {
        console.log('[DB 옵션 flat array 감지]', optionsData);
        self.allOptions.set(optionsData);
        const maxDepth = Math.max(...optionsData.map(item => item.path.split('/').length - 1));
        self.maxExistingDepth.set(maxDepth);
        console.log('[flat array allOptions]', optionsData, 'maxDepth:', maxDepth);
      } else {
        console.log('[DB 옵션 알 수 없음]', optionsData);
      }
    };
    self.loadApiOptions();
    // 외부에서 apiLoaded를 false로 바꾸면 다시 호출
    this.autorun(() => {
      if (self.apiLoaded.get() === false) {
        self.loadApiOptions();
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
        // 카드 데이터에도 반영
        this.card.setCustomField(this.customFieldId, [...selectedValues]);
        // 삭제한 인덱스가 현재 editIndex와 같으면 변경 모드 해제 및 폼 닫기
        if (this.editIndex && typeof this.editIndex.get === 'function') {
          if (this.editIndex.get() === index) {
            this.editIndex.set(null);
            if (this.closeForm) this.closeForm();
          } else if (this.editIndex.get() > index) {
            this.editIndex.set(this.editIndex.get() - 1);
          }
        }
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
  editIndex() {
    // null 또는 undefined면 null 반환, 0 이상이면 0 반환
    return this.editIndex && typeof this.editIndex.get === 'function'
      ? this.editIndex.get()
      : null;
  }
  isEditIndexValid() {
    const idx = this.editIndex && typeof this.editIndex.get === 'function'
      ? this.editIndex.get()
      : null;
    return idx !== null && idx !== undefined;
  }
}.register('cardCustomField-apiDropdown'));

console.log('[cardCustomFields.js 파일 실행 완료]');
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
    const value = this.data().value;
    if (!value) return TAPi18n.__('custom-field-dropdown-none');

    // 선택된 값을 '>'로 구분하여 표시
    const parts = value.split('/');
    return parts.join(' > ');
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
