"""
Enhanced Playwright Script Analyzer - Active Intelligence Mode
Comprehensive analysis of Playwright test scripts with proactive recommendations.

Extracts and Analyzes:
- Input fields (all modern + legacy locators)
- Actions (click, navigate, wait, keyboard, mouse, scroll)
- Assertions and expected outcomes
- Field types with intelligent constraints
- External data sources (JSON, CSV, Excel, API)
- Test patterns (POM, Fixtures, Data-Driven)
- XPath analysis (type, complexity, stability)
- Test context (descriptions, tags, timeouts, retries)
- Interaction patterns (keyboard combos, mouse gestures)
- Script quality metrics with proactive recommendations

Used for:
- Automated test data generation (security, boundary, equivalence)
- Test quality assessment and improvement
- Self-healing locator recommendations
- Test maintenance optimization
"""

import re
import json
import os
from typing import List, Dict, Any, Optional, Tuple, Set
from dataclasses import dataclass, asdict, field
from enum import Enum
from pathlib import Path


class FieldType(str, Enum):
    TEXT = "text"
    NUMBER = "number"
    EMAIL = "email"
    PASSWORD = "password"
    TEL = "tel"
    URL = "url"
    SEARCH = "search"
    DATE = "date"
    TEXTAREA = "textarea"
    SELECT = "select"
    CHECKBOX = "checkbox"
    RADIO = "radio"


class ActionType(str, Enum):
    FILL = "fill"
    TYPE = "type"
    CLICK = "click"
    SELECT_OPTION = "selectOption"
    CHECK = "check"
    UNCHECK = "uncheck"
    NAVIGATE = "goto"
    WAIT = "waitFor"
    PRESS = "press"
    HOVER = "hover"
    DRAG = "drag"
    SCROLL = "scroll"
    SCREENSHOT = "screenshot"
    UPLOAD = "setInputFiles"
    DOUBLE_CLICK = "dblclick"
    RIGHT_CLICK = "contextMenu"


class XPathType(str, Enum):
    ABSOLUTE = "absolute"  # /html/body/div[1]
    RELATIVE = "relative"  # //button[@id='submit']
    PREFIXED = "prefixed"  # xpath=//div


class LocatorQuality(str, Enum):
    EXCELLENT = "excellent"  # Role-based, label-based
    GOOD = "good"           # Test IDs, stable attributes
    FAIR = "fair"           # CSS selectors with semantic meaning
    POOR = "poor"           # Generic classes, XPath
    UNSTABLE = "unstable"   # Dynamic IDs, absolute XPath


class TestPattern(str, Enum):
    BASIC = "basic"
    PAGE_OBJECT = "page_object_model"
    FIXTURE = "fixture_based"
    DATA_DRIVEN = "data_driven"
    API_HYBRID = "api_hybrid"
    COMPONENT = "component_testing"


@dataclass
class InputField:
    selector: str
    field_type: FieldType
    field_name: str
    action: ActionType
    line_number: int
    example_value: Optional[str] = None
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    pattern: Optional[str] = None
    required: bool = True
    constraints: Optional[Dict[str, Any]] = None


@dataclass
class ScriptAction:
    action_type: ActionType
    target: str
    value: Optional[str] = None
    line_number: int = 0
    quality: Optional[LocatorQuality] = None
    recommendation: Optional[str] = None


@dataclass
class XPathAnalysis:
    xpath: str
    xpath_type: XPathType
    complexity_score: int  # 0-100
    stability_score: int   # 0-100
    recommended_alternative: Optional[str] = None
    issues: List[str] = field(default_factory=list)
    line_number: int = 0


@dataclass
class ExternalDataSource:
    source_type: str  # 'json', 'csv', 'excel', 'api'
    file_path: Optional[str] = None
    api_endpoint: Optional[str] = None
    line_number: int = 0
    fields: List[str] = field(default_factory=list)


@dataclass
class TestContext:
    test_name: Optional[str] = None
    description: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    timeout: Optional[int] = None
    retries: Optional[int] = None
    browser_config: Optional[Dict[str, Any]] = None
    fixtures: List[str] = field(default_factory=list)
    has_hooks: bool = False


@dataclass
class InteractionPattern:
    pattern_type: str  # 'keyboard_combo', 'mouse_gesture', 'scroll_sequence'
    actions: List[str] = field(default_factory=list)
    complexity: str = "simple"  # simple, moderate, complex
    line_number: int = 0


@dataclass
class ScriptAnalysis:
    input_fields: List[InputField]
    actions: List[ScriptAction]
    navigation_url: Optional[str] = None
    assertions: List[Dict[str, Any]] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)
    
    # Enhanced analysis data
    xpath_analysis: List[XPathAnalysis] = field(default_factory=list)
    external_data_sources: List[ExternalDataSource] = field(default_factory=list)
    test_context: Optional[TestContext] = None
    interaction_patterns: List[InteractionPattern] = field(default_factory=list)
    detected_pattern: Optional[TestPattern] = None
    quality_score: int = 0  # 0-100
    recommendations: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self):
        def _serialize(obj):
            """Recursively convert enums to their .value strings in dicts/lists."""
            if isinstance(obj, dict):
                return {k: _serialize(v) for k, v in obj.items()}
            if isinstance(obj, list):
                return [_serialize(i) for i in obj]
            if hasattr(obj, 'value') and hasattr(obj, '__class__') and issubclass(obj.__class__, str):
                return obj.value
            return obj

        def _field_to_dict(f):
            d = asdict(f)
            d['field_type'] = f.field_type.value
            d['action'] = f.action.value
            return d

        def _action_to_dict(a):
            d = asdict(a)
            d['action_type'] = a.action_type.value
            d['quality'] = a.quality.value
            return d

        return {
            'input_fields': [_field_to_dict(f) for f in self.input_fields],
            'actions': [_action_to_dict(a) for a in self.actions],
            'navigation_url': self.navigation_url,
            'assertions': self.assertions,
            'summary': _serialize(self.summary),
            'xpath_analysis': [asdict(x) for x in self.xpath_analysis],
            'external_data_sources': [asdict(d) for d in self.external_data_sources],
            'test_context': asdict(self.test_context) if self.test_context else None,
            'interaction_patterns': [asdict(p) for p in self.interaction_patterns],
            'detected_pattern': self.detected_pattern.value if self.detected_pattern else None,
            'quality_score': self.quality_score,
            'recommendations': self.recommendations
        }


class PlaywrightScriptAnalyzer:
    """Enhanced Playwright Script Analyzer with Active Intelligence"""

    # Regex patterns for ALL Playwright commands + enhanced patterns (100+ patterns)
    PATTERNS = {
        # ============ NAVIGATION PATTERNS ============
        'goto': r'(?:page|context)\.goto\([\'"]([^\'"]+)[\'"]',
        'goBack': r'(?:page|context)\.goBack\(\)',
        'goForward': r'(?:page|context)\.goForward\(\)',
        'reload': r'(?:page|context)\.reload\(\)',
        'setViewportSize': r'page\.setViewportSize\(\{[^}]*width:\s*(\d+).*?height:\s*(\d+)',
        'route': r'page\.route\([\'"]([^\'"]+)[\'"]',
        'unroute': r'page\.unroute\([\'"]([^\'"]+)[\'"]',
        
        # ============ LEGACY LOCATOR METHODS ============
        # Group 1 = opening quote, Group 2 = selector (supports single, double, backtick; handles ) in selectors)
        'fill': r"(?:page|locator)\.fill\((['\"`])(.*?)\1",
        'type': r"(?:page|locator)\.type\((['\"`])(.*?)\1",
        'pressSequentially': r"(?:page|locator)\.pressSequentially\((['\"`])(.*?)\1",
        'click': r'(?:page|locator)\.click\([\'"]([^\'"]+)[\'"]',
        'press': r'(?:page|locator)\.press\([\'"]([^\'"]+)[\'"],\s*[\'"]([^\'"]*)[\'"]',
        'selectOption': r"(?:page|locator)\.selectOption\((['\"`])(.*?)\1",
        'check': r"(?:page|locator)\.check\((['\"`])(.*?)\1",
        'uncheck': r"(?:page|locator)\.uncheck\((['\"`])(.*?)\1",
        'focus': r'(?:page|locator)\.focus\([\'"]([^\'"]+)[\'"]',
        'blur': r'(?:page|locator)\.blur\([\'"]([^\'"]+)[\'"]',
        'clear': r'(?:page|locator)\.clear\([\'"]([^\'"]+)[\'"]',
        'tap': r'(?:page|locator)\.tap\([\'"]([^\'"]+)[\'"]',
        # ============ CHAINED LOCATOR PATTERNS ============
        # Catches page.locator('sel').fill/selectOption/check — Group 1 = quote, Group 2 = selector
        'locator_fill': r"\.locator\((['\"`])(.*?)\1\)\.(?:fill|type|pressSequentially)\(",
        'locator_select': r"\.locator\((['\"`])(.*?)\1\)\.selectOption\(",
        'locator_check': r"\.locator\((['\"`])(.*?)\1\)\.(?:check|uncheck)\(",
        
        # ============ ENHANCED INTERACTION PATTERNS ============
        'hover': r'(?:page|locator)\.hover\([\'"]?([^\'"\)]+)?[\'"]?\)',
        'dblclick': r'(?:page|locator)\.dblclick\([\'"]([^\'"]+)[\'"]',
        'dragAndDrop': r'(?:page|locator)\.dragAndDrop\([\'"]([^\'"]+)[\'"],\s*[\'"]([^\'"]+)[\'"]',
        'setInputFiles': r'(?:page|locator)\.setInputFiles\([\'"]([^\'"]+)[\'"],\s*[\'"]([^\'"]+)[\'"]',
        'screenshot': r'(?:page|locator)\.screenshot\(',
        'scroll': r'(?:page|locator)\.scroll(?:IntoView)?',
        'dispatchEvent': r'(?:page|locator)\.dispatchEvent\([\'"]([^\'"]+)[\'"]',
        'evaluate': r'(?:page|locator)\.evaluate\(',
        'evaluateHandle': r'(?:page|locator)\.evaluateHandle\(',
        'addScriptTag': r'page\.addScriptTag\(',
        'addStyleTag': r'page\.addStyleTag\(',
        
        # ============ MODERN PLAYWRIGHT LOCATORS (getBy*) ============
        # getByRole: Group 1=quote, Group 2=role, Group 3=name-quote, Group 4=name
        'getByRole': r"(?:page|locator)\.getByRole\((['\"`])(.*?)\1(?:,\s*\{[^}]*name:\s*(['\"`])(.*?)\3)?",
        # getByLabel/getByPlaceholder/getByTestId: Group 1=quote, Group 2=text
        'getByLabel': r"(?:page|locator)\.getByLabel\((['\"`])(.*?)\1",
        'getByPlaceholder': r"(?:page|locator)\.getByPlaceholder\((['\"`])(.*?)\1",
        'getByText': r'(?:page|locator)\.getByText\([\'"]([^\'"]+)[\'"]',
        'getByTestId': r"(?:page|locator)\.getByTestId\((['\"`])(.*?)\1",
        'getByAltText': r'(?:page|locator)\.getByAltText\([\'"]([^\'"]+)[\'"]',
        'getByTitle': r'(?:page|locator)\.getByTitle\([\'"]([^\'"]+)[\'"]',
        
        # ============ CHAINED LOCATORS & FILTERS ============
        'locator': r'(?:page|locator)\.locator\([\'"]([^\'"]+)[\'"]',
        'first': r'\.first\(\)',
        'last': r'\.last\(\)',
        'nth': r'\.nth\((\d+)\)',
        'filter': r'\.filter\(\{[^}]*hasText:\s*[\'"]([^\'"]+)[\'"]',
        # nth/filter chained with fill/select/check — Group 1=quote, Group 2=selector
        'locator_nth_fill': r"\.locator\((['\"`])(.*?)\1\)(?:\.nth\(\d+\)|\.first\(\)|\.last\(\))*\.(?:fill|type|pressSequentially)\(",
        'locator_nth_select': r"\.locator\((['\"`])(.*?)\1\)(?:\.nth\(\d+\)|\.first\(\)|\.last\(\))*\.selectOption\(",
        'locator_nth_check': r"\.locator\((['\"`])(.*?)\1\)(?:\.nth\(\d+\)|\.first\(\)|\.last\(\))*\.(?:check|uncheck)\(",
        'locator_filter_fill': r"\.locator\((['\"`])(.*?)\1\)\.filter\([^)]*\)\.(?:fill|type|pressSequentially)\(",
        'locator_filter_select': r"\.locator\((['\"`])(.*?)\1\)\.filter\([^)]*\)\.selectOption\(",
        'locator_filter_check': r"\.locator\((['\"`])(.*?)\1\)\.filter\([^)]*\)\.(?:check|uncheck)\(",
        'and': r'\.and\(',
        'or': r'\.or\(',
        'not': r'\.not\(',
        'frameLocator': r'page\.frameLocator\([\'"]([^\'"]+)[\'"]',
        
        # ============ WAIT METHODS (Extended) ============
        'waitFor': r'(?:page|locator)\.waitFor(?:Selector)?\([\'"]([^\'"]+)[\'"]',
        'waitForLoadState': r'page\.waitForLoadState\([\'"]?([^\'"\)]*)[\'"]?\)',
        'waitForTimeout': r'page\.waitForTimeout\((\d+)\)',
        'waitForURL': r'page\.waitForURL\([\'"]?([^\'"\)]+)?[\'"]?\)',
        'waitForEvent': r'page\.waitForEvent\([\'"]([^\'"]+)[\'"]',
        'waitForFunction': r'page\.waitForFunction\(',
        'waitForRequest': r'page\.waitForRequest\([\'"]([^\'"]+)[\'"]',
        'waitForResponse': r'page\.waitForResponse\([\'"]([^\'"]+)[\'"]',
        'waitForNavigation': r'page\.waitForNavigation\(',
        
        # ============ ASSERTIONS (Comprehensive) ============
        'expect': r'expect\(([^)]+)\)',
        'toBeVisible': r'\.toBeVisible\(\)',
        'toBeHidden': r'\.toBeHidden\(\)',
        'toBeEnabled': r'\.toBeEnabled\(\)',
        'toBeDisabled': r'\.toBeDisabled\(\)',
        'toBeEditable': r'\.toBeEditable\(\)',
        'toBeFocused': r'\.toBeFocused\(\)',
        'toHaveText': r'\.toHaveText\([\'"]([^\'"]+)[\'"]',
        'toHaveValue': r'\.toHaveValue\([\'"]([^\'"]+)[\'"]',
        'toBeChecked': r'\.toBeChecked\(\)',
        'toHaveURL': r'\.toHaveURL\([\'"]?([^\'"\)]+)?[\'"]?\)',
        'toContainText': r'\.toContainText\([\'"]([^\'"]+)[\'"]',
        'toHaveAttribute': r'\.toHaveAttribute\([\'"]([^\'"]+)[\'"],\s*[\'"]([^\'"]+)[\'"]',
        'toHaveClass': r'\.toHaveClass\([\'"]([^\'"]+)[\'"]',
        'toHaveCount': r'\.toHaveCount\((\d+)\)',
        'toHaveCSS': r'\.toHaveCSS\([\'"]([^\'"]+)[\'"],\s*[\'"]([^\'"]+)[\'"]',
        'toHaveId': r'\.toHaveId\([\'"]([^\'"]+)[\'"]',
        'toHaveJSProperty': r'\.toHaveJSProperty\([\'"]([^\'"]+)[\'"]',
        'toHaveTitle': r'\.toHaveTitle\([\'"]([^\'"]+)[\'"]',
        'toHaveScreenshot': r'\.toHaveScreenshot\(',
        'toMatchSnapshot': r'\.toMatchSnapshot\(',
        
        # ============ XPATH SELECTORS (All Variations) ============
        'xpath_absolute': r'xpath=(/html[^\'"]*)[\'"]',
        'xpath_relative': r'xpath=(//[^\'"]*)[\'"]',
        'xpath_inline': r'[\'"]xpath=([^\'"]*)[\'"]',
        'xpath_text': r'xpath=//.*\[contains\(text\(\)',
        'xpath_attribute': r'xpath=//.*\[@([a-zA-Z-]+)=[\'"]',
        
        # ============ CSS SELECTORS (Advanced) ============
        'css_id': r'#([a-zA-Z][a-zA-Z0-9_-]*)',
        'css_class': r'\.([a-zA-Z][a-zA-Z0-9_-]*)',
        'css_attr': r'\[([a-zA-Z-]+)=[\'"]([^\'"]+)[\'"]\]',
        'css_pseudo': r'::?([a-z-]+)',
        'css_combinator': r'>|\+|~',
        'css_nth_child': r':nth-child\((\d+)\)',
        'css_nth_of_type': r':nth-of-type\((\d+)\)',
        
        # ============ EXTERNAL DATA SOURCES ============
        'json_import': r'import\s+.*from\s+[\'"]([^\'"]*\.json)[\'"]',
        'csv_import': r'import\s+.*from\s+[\'"]([^\'"]*\.csv)[\'"]',
        'excel_import': r'xlsx\.readFile\([\'"]([^\'"]+\.xlsx)[\'"]',
        'yaml_import': r'import\s+.*from\s+[\'"]([^\'"]*\.ya?ml)[\'"]',
        'api_call': r'(?:await\s+)?(?:request|axios|fetch)\.(?:get|post|put|delete|patch)\([\'"]([^\'"]+)[\'"]',
        'api_interceptor': r'page\.route\([\'"]([^\'"]+)[\'"]',
        'require_json': r'require\([\'"]([^\'"]*\.json)[\'"]\)',
        'readFile': r'readFile(?:Sync)?\([\'"]([^\'"]+)[\'"]',
        'fetch_api': r'fetch\([\'"]([^\'"]+)[\'"]',
        'graphql_query': r'(?:query|mutation)\s+(\w+)',
        'rest_endpoint': r'(?:GET|POST|PUT|DELETE|PATCH)\s+[\'"]([^\'"]+)[\'"]',
        
        # ============ BROWSER CONTEXT & PAGES ============
        'newPage': r'context\.newPage\(\)',
        'newContext': r'browser\.newContext\(',
        'close_page': r'page\.close\(\)',
        'close_context': r'context\.close\(\)',
        'cookies': r'context\.cookies\(',
        'addCookies': r'context\.addCookies\(',
        'clearCookies': r'context\.clearCookies\(',
        'localStorage': r'page\.evaluate\(.*localStorage',
        'sessionStorage': r'page\.evaluate\(.*sessionStorage',
        
        # ============ AUTHENTICATION & SECURITY ============
        'basicAuth': r'httpCredentials:\s*\{',
        'setExtraHTTPHeaders': r'page\.setExtraHTTPHeaders\(',
        'storageState': r'storageState:\s*[\'"]([^\'"]+)[\'"]',
        'permissions': r'context\.grantPermissions\(',
        'geolocation': r'context\.setGeolocation\(',
        'timezone': r'timezoneId:\s*[\'"]([^\'"]+)[\'"]',
        'locale': r'locale:\s*[\'"]([^\'"]+)[\'"]',
        
        # ============ NETWORK & API PATTERNS ============
        'onRequest': r'page\.on\([\'"]request[\'"]',
        'onResponse': r'page\.on\([\'"]response[\'"]',
        'onRequestFailed': r'page\.on\([\'"]requestfailed[\'"]',
        'request_method': r'request\.method\(\)',
        'request_url': r'request\.url\(\)',
        'response_status': r'response\.status\(\)',
        'response_json': r'response\.json\(\)',
        'abort_request': r'request\.abort\(',
        'fulfill_request': r'route\.fulfill\(',
        
        # ============ DIALOG & POPUP HANDLING ============
        'onDialog': r'page\.on\([\'"]dialog[\'"]',
        'acceptDialog': r'dialog\.accept\(',
        'dismissDialog': r'dialog\.dismiss\(',
        'popup': r'page\.waitForEvent\([\'"]popup[\'"]',
        'fileChooser': r'page\.waitForEvent\([\'"]filechooser[\'"]',
        'download': r'page\.waitForEvent\([\'"]download[\'"]',
        
        # ============ FRAMES & IFRAMES ============
        'frame': r'page\.frame\([\'"]([^\'"]+)[\'"]',
        'frames': r'page\.frames\(\)',
        'mainFrame': r'page\.mainFrame\(\)',
        'childFrames': r'frame\.childFrames\(\)',
        'frameLocator': r'page\.frameLocator\([\'"]([^\'"]+)[\'"]',
        
        # ============ MOBILE & DEVICE EMULATION ============
        'emulate_device': r'devices\[[\'"]([^\'"]+)[\'"]\]',
        'userAgent': r'userAgent:\s*[\'"]([^\'"]+)[\'"]',
        'isMobile': r'isMobile:\s*(true|false)',
        'hasTouch': r'hasTouch:\s*(true|false)',
        'deviceScaleFactor': r'deviceScaleFactor:\s*(\d+)',
        
        # ============ VIDEO & TRACING ============
        'video': r'video:\s*\{',
        'startTracing': r'context\.tracing\.start\(',
        'stopTracing': r'context\.tracing\.stop\(',
        'screenshot_fullpage': r'screenshot\(.*fullPage:\s*true',
        
        # ============ TEST PATTERNS & ORGANIZATION ============
        'test_describe': r'test\.describe\([\'"]([^\'"]+)[\'"]',
        'test_describe_parallel': r'test\.describe\.parallel\([\'"]([^\'"]+)[\'"]',
        'test_describe_serial': r'test\.describe\.serial\([\'"]([^\'"]+)[\'"]',
        'test_name': r'test\([\'"]([^\'"]+)[\'"]',
        'test_only': r'test\.only\([\'"]([^\'"]+)[\'"]',
        'test_skip': r'test\.skip\([\'"]([^\'"]+)[\'"]',
        'test_fixme': r'test\.fixme\([\'"]([^\'"]+)[\'"]',
        'test_fail': r'test\.fail\(',
        'test_slow': r'test\.slow\(',
        'test_step': r'test\.step\([\'"]([^\'"]+)[\'"]',
        
        # ============ HOOKS & FIXTURES ============
        'beforeEach': r'test\.beforeEach',
        'afterEach': r'test\.afterEach',
        'beforeAll': r'test\.beforeAll',
        'afterAll': r'test\.afterAll',
        'fixture_extend': r'test\.extend',
        'fixture_use': r'\{\s*(\w+)\s*\}.*=>',
        'page_object_class': r'class\s+(\w+)(?:Page|Component|Widget|Section)',
        'mount_component': r'mount\(<(\w+)',
        'test_use': r'test\.use\(',
        
        # ============ CONFIGURATION & SETTINGS ============
        'test_timeout': r'test\.setTimeout\((\d+)\)',
        'test_retries': r'test\.(?:describe\.)?configure\(\{\s*retries:\s*(\d+)',
        'playwright_config': r'defineConfig\(',
        'projects': r'projects:\s*\[',
        'globalSetup': r'globalSetup:\s*[\'"]([^\'"]+)[\'"]',
        'globalTeardown': r'globalTeardown:\s*[\'"]([^\'"]+)[\'"]',
        
        # ============ ACCESSIBILITY TESTING ============
        'accessibility': r'page\.accessibility\.',
        'ariaSnapshot': r'toMatchAriaSnapshot\(',
        'axe_audit': r'injectAxe\(\)|checkA11y\(',
        
        # ============ VISUAL TESTING ============
        'percy': r'percySnapshot\(',
        'applitools': r'eyes\.',
        'visual_comparison': r'toMatchImageSnapshot\(',
        
        # ============ DATABASE & BACKEND ============
        'db_query': r'(?:query|execute)\([\'"]([^\'"]+)[\'"]',
        'sql_select': r'SELECT\s+.*\s+FROM\s+(\w+)',
        'sql_insert': r'INSERT\s+INTO\s+(\w+)',
        'sql_update': r'UPDATE\s+(\w+)',
        'sql_delete': r'DELETE\s+FROM\s+(\w+)',
        'mongodb': r'(?:findOne|find|insertOne|updateOne)\(',
        
        # ============ PERFORMANCE & METRICS ============
        'performance': r'performance\.(?:measure|mark|now)',
        'lighthouse': r'lighthouse\(',
        'web_vitals': r'getLCP|getFID|getCLS',
        
        # ============ ERROR HANDLING & DEBUGGING ============
        'try_catch': r'try\s*\{',
        'throw_error': r'throw\s+new\s+Error',
        'console_log': r'console\.(?:log|error|warn|info)\(',
        'debugger': r'debugger',
        'page_pause': r'page\.pause\(\)',
    }

    def analyze(self, script_code: str) -> ScriptAnalysis:
        """
        Enhanced analysis of Playwright script with active intelligence
        Extracts ALL testable elements, patterns, and provides proactive recommendations
        """
        input_fields = []
        actions = []
        navigation_url = None
        assertions = []
        xpath_analysis = []
        external_data_sources = []
        interaction_patterns = []
        
        # Test context tracking
        test_context = TestContext()
        
        # Pattern detection
        has_page_object = False
        has_fixtures = False
        has_data_driven = False
        has_api_hybrid = False
        has_component = False
        
        # === PRE-PROCESS: join multiline chained calls into single logical lines ===
        # e.g. page\n  .getByLabel('Email')\n  .fill('val')  →  page.getByLabel('Email').fill('val')
        raw_lines = script_code.split('\n')
        joined_lines: list[str] = []
        buffer = ''
        for raw in raw_lines:
            stripped = raw.strip()
            if stripped.startswith('.') and buffer:
                buffer = buffer.rstrip() + stripped
            else:
                if buffer:
                    joined_lines.append(buffer)
                buffer = raw
        if buffer:
            joined_lines.append(buffer)
        lines = joined_lines

        for line_num, line in enumerate(lines, start=1):
            line_stripped = line.strip()

            # === EXTRACT TEST CONTEXT ===
            
            # Test description/name
            test_desc_match = re.search(self.PATTERNS['test_describe'], line_stripped)
            if test_desc_match:
                test_context.description = test_desc_match.group(1)
            
            test_name_match = re.search(self.PATTERNS['test_name'], line_stripped)
            if test_name_match and not test_context.test_name:
                test_context.test_name = test_name_match.group(1)
            
            # Test hooks
            if re.search(self.PATTERNS['beforeEach'], line_stripped) or re.search(self.PATTERNS['afterEach'], line_stripped):
                test_context.has_hooks = True
            
            # Timeout configuration
            timeout_match = re.search(self.PATTERNS['test_timeout'], line_stripped)
            if timeout_match:
                test_context.timeout = int(timeout_match.group(1))
            
            # Retry configuration
            retries_match = re.search(self.PATTERNS['test_retries'], line_stripped)
            if retries_match:
                test_context.retries = int(retries_match.group(1))
            
            # Fixture detection
            if re.search(self.PATTERNS['fixture_extend'], line_stripped):
                has_fixtures = True
                test_context.fixtures.append('custom_fixture')
            
            if re.search(self.PATTERNS['test_use'], line_stripped):
                has_fixtures = True
            
            # === DETECT TEST PATTERNS ===
            
            # Page Object Model
            pom_match = re.search(self.PATTERNS['page_object_class'], line_stripped)
            if pom_match:
                has_page_object = True
            
            # Component testing
            component_match = re.search(self.PATTERNS['mount_component'], line_stripped)
            if component_match:
                has_component = True
            
            # === EXTRACT EXTERNAL DATA SOURCES ===
            
            # JSON files
            json_match = re.search(self.PATTERNS['json_import'], line_stripped)
            if not json_match:
                json_match = re.search(self.PATTERNS['require_json'], line_stripped)
            if json_match:
                has_data_driven = True
                external_data_sources.append(ExternalDataSource(
                    source_type='json',
                    file_path=json_match.group(1),
                    line_number=line_num
                ))
            
            # CSV files
            csv_match = re.search(self.PATTERNS['csv_import'], line_stripped)
            if csv_match:
                has_data_driven = True
                external_data_sources.append(ExternalDataSource(
                    source_type='csv',
                    file_path=csv_match.group(1),
                    line_number=line_num
                ))
            
            # Excel files
            excel_match = re.search(self.PATTERNS['excel_import'], line_stripped)
            if excel_match:
                has_data_driven = True
                external_data_sources.append(ExternalDataSource(
                    source_type='excel',
                    file_path=excel_match.group(1),
                    line_number=line_num
                ))
            
            # API calls
            api_match = re.search(self.PATTERNS['api_call'], line_stripped)
            if api_match:
                has_api_hybrid = True
                external_data_sources.append(ExternalDataSource(
                    source_type='api',
                    api_endpoint=api_match.group(1),
                    line_number=line_num
                ))
            
            # === XPATH DEEP ANALYSIS ===
            
            # Absolute XPath
            xpath_abs_match = re.search(self.PATTERNS['xpath_absolute'], line_stripped)
            if xpath_abs_match:
                xpath = xpath_abs_match.group(1)
                analysis = self._analyze_xpath(xpath, XPathType.ABSOLUTE, line_num)
                xpath_analysis.append(analysis)
            
            # Relative XPath
            xpath_rel_match = re.search(self.PATTERNS['xpath_relative'], line_stripped)
            if xpath_rel_match:
                xpath = xpath_rel_match.group(1)
                analysis = self._analyze_xpath(xpath, XPathType.RELATIVE, line_num)
                xpath_analysis.append(analysis)

            # Extract navigation URL
            if not navigation_url:
                goto_match = re.search(self.PATTERNS['goto'], line_stripped)
                if goto_match:
                    navigation_url = goto_match.group(1)
                    actions.append(ScriptAction(
                        action_type=ActionType.NAVIGATE,
                        target=navigation_url,
                        line_number=line_num,
                        quality=LocatorQuality.EXCELLENT
                    ))

            # ===== MODERN PLAYWRIGHT LOCATORS (getBy* methods) =====
            
            # getByRole - Most recommended by Playwright
            # Pattern groups: 1=quote, 2=role, 3=name-quote, 4=name
            role_match = re.search(self.PATTERNS['getByRole'], line_stripped)
            if role_match:
                role = role_match.group(2)
                name = role_match.group(4) if role_match.lastindex and role_match.lastindex >= 4 else None
                selector = f"getByRole('{role}', {{ name: '{name}' }})"

                # Determine action type
                action_type = self._detect_action_from_line(line_stripped)
                if action_type in [ActionType.FILL, ActionType.TYPE, ActionType.CHECK, ActionType.SELECT_OPTION]:
                    field_type, field_name, constraints = self._detect_field_from_role(role, name)
                    input_fields.append(InputField(
                        selector=selector,
                        field_type=field_type,
                        field_name=field_name or name or role,
                        action=action_type,
                        line_number=line_num,
                        constraints=constraints
                    ))
                
                actions.append(ScriptAction(
                    action_type=action_type or ActionType.CLICK,
                    target=selector,
                    line_number=line_num,
                    quality=LocatorQuality.EXCELLENT,
                    recommendation="✅ Excellent: Role-based locators are Playwright's recommended approach"
                ))
            
            # getByLabel
            # Pattern groups: 1=quote, 2=label text
            label_match = re.search(self.PATTERNS['getByLabel'], line_stripped)
            if label_match:
                label_text = label_match.group(2)
                selector = f"getByLabel('{label_text}')"
                action_type = self._detect_action_from_line(line_stripped)

                if action_type in [ActionType.FILL, ActionType.TYPE, ActionType.SELECT_OPTION, ActionType.CHECK, ActionType.UNCHECK]:
                    if action_type == ActionType.SELECT_OPTION:
                        field_type, field_name, constraints = FieldType.SELECT, label_text, {}
                    elif action_type in [ActionType.CHECK, ActionType.UNCHECK]:
                        field_type, field_name, constraints = FieldType.CHECKBOX, label_text, {}
                    else:
                        field_type, field_name, constraints = self._detect_field_info(label_text, '')
                    input_fields.append(InputField(
                        selector=selector,
                        field_type=field_type,
                        field_name=field_name or label_text,
                        action=action_type,
                        line_number=line_num,
                        constraints=constraints
                    ))
                
                actions.append(ScriptAction(
                    action_type=action_type or ActionType.CLICK,
                    target=selector,
                    line_number=line_num,
                    quality=LocatorQuality.EXCELLENT
                ))
            
            # getByPlaceholder — Group 1=quote, Group 2=placeholder text
            placeholder_match = re.search(self.PATTERNS['getByPlaceholder'], line_stripped)
            if placeholder_match:
                placeholder = placeholder_match.group(2)
                selector = f"getByPlaceholder('{placeholder}')"
                action_type = self._detect_action_from_line(line_stripped)

                if action_type in [ActionType.FILL, ActionType.TYPE, ActionType.SELECT_OPTION, ActionType.CHECK]:
                    field_type, field_name, constraints = self._detect_field_info(placeholder, '')
                    input_fields.append(InputField(
                        selector=selector,
                        field_type=field_type,
                        field_name=field_name or placeholder,
                        action=action_type,
                        line_number=line_num,
                        constraints=constraints
                    ))
                
                actions.append(ScriptAction(
                    action_type=action_type or ActionType.CLICK,
                    target=selector,
                    line_number=line_num,
                    quality=LocatorQuality.EXCELLENT
                ))
            
            # getByTestId — Group 1=quote, Group 2=test id
            testid_match = re.search(self.PATTERNS['getByTestId'], line_stripped)
            if testid_match:
                test_id = testid_match.group(2)
                selector = f"getByTestId('{test_id}')"
                action_type = self._detect_action_from_line(line_stripped)

                if action_type in [ActionType.FILL, ActionType.TYPE, ActionType.CHECK, ActionType.SELECT_OPTION]:
                    if action_type == ActionType.SELECT_OPTION:
                        field_type, field_name, constraints = FieldType.SELECT, test_id, {}
                    elif action_type == ActionType.CHECK:
                        field_type, field_name, constraints = FieldType.CHECKBOX, test_id, {}
                    else:
                        field_type, field_name, constraints = self._detect_field_info(test_id, '')
                    input_fields.append(InputField(
                        selector=selector,
                        field_type=field_type,
                        field_name=field_name or test_id,
                        action=action_type,
                        line_number=line_num,
                        constraints=constraints
                    ))
                
                actions.append(ScriptAction(
                    action_type=action_type or ActionType.CLICK,
                    target=selector,
                    line_number=line_num,
                    quality=LocatorQuality.GOOD
                ))
            
            # getByText
            text_match = re.search(self.PATTERNS['getByText'], line_stripped)
            if text_match and '.click()' in line_stripped:
                text = text_match.group(1)
                actions.append(ScriptAction(
                    action_type=ActionType.CLICK,
                    target=f"getByText('{text}')",
                    line_number=line_num,
                    quality=LocatorQuality.GOOD
                ))

            # getByAltText — Group 1=quote, Group 2=alt text (updated pattern below)
            alttext_match = re.search(self.PATTERNS['getByAltText'], line_stripped)
            if alttext_match:
                alt_text = alttext_match.group(1)
                selector = f"getByAltText('{alt_text}')"
                action_type = self._detect_action_from_line(line_stripped)
                if action_type in [ActionType.FILL, ActionType.TYPE, ActionType.CHECK, ActionType.SELECT_OPTION]:
                    field_type, field_name, constraints = self._detect_field_info(alt_text, '')
                    input_fields.append(InputField(
                        selector=selector,
                        field_type=field_type,
                        field_name=field_name or alt_text,
                        action=action_type,
                        line_number=line_num,
                        constraints=constraints
                    ))
                actions.append(ScriptAction(
                    action_type=action_type or ActionType.CLICK,
                    target=selector,
                    line_number=line_num,
                    quality=LocatorQuality.GOOD
                ))

            # getByTitle — Group 1=title text
            title_match = re.search(self.PATTERNS['getByTitle'], line_stripped)
            if title_match:
                title_text = title_match.group(1)
                selector = f"getByTitle('{title_text}')"
                action_type = self._detect_action_from_line(line_stripped)
                if action_type in [ActionType.FILL, ActionType.TYPE, ActionType.CHECK, ActionType.SELECT_OPTION]:
                    field_type, field_name, constraints = self._detect_field_info(title_text, '')
                    input_fields.append(InputField(
                        selector=selector,
                        field_type=field_type,
                        field_name=field_name or title_text,
                        action=action_type,
                        line_number=line_num,
                        constraints=constraints
                    ))
                actions.append(ScriptAction(
                    action_type=action_type or ActionType.CLICK,
                    target=selector,
                    line_number=line_num,
                    quality=LocatorQuality.GOOD
                ))

            # ===== LEGACY LOCATOR METHODS =====
            # Patterns now use group(1)=quote, group(2)=selector via backreference

            # Extract fill / type / pressSequentially actions
            fill_match = re.search(self.PATTERNS['fill'], line_stripped)
            type_match = re.search(self.PATTERNS['type'], line_stripped) if not fill_match else None
            press_seq_match = re.search(self.PATTERNS['pressSequentially'], line_stripped) if not fill_match and not type_match else None
            active_fill = fill_match or type_match or press_seq_match
            if active_fill:
                selector = active_fill.group(2)
                field_type, field_name, constraints = self._detect_field_info(selector, '')
                input_fields.append(InputField(
                    selector=selector,
                    field_type=field_type,
                    field_name=field_name,
                    action=ActionType.FILL,
                    line_number=line_num,
                    constraints=constraints
                ))
                quality = self._assess_locator_quality(selector)
                actions.append(ScriptAction(
                    action_type=ActionType.FILL,
                    target=selector,
                    line_number=line_num,
                    quality=quality
                ))

            # Extract chained locator fill: page.locator('sel').fill/type/pressSequentially(...)
            locator_fill_match = re.search(self.PATTERNS['locator_fill'], line_stripped)
            if locator_fill_match:
                selector = locator_fill_match.group(2)
                field_type, field_name, constraints = self._detect_field_info(selector, '')
                input_fields.append(InputField(
                    selector=selector,
                    field_type=field_type,
                    field_name=field_name,
                    action=ActionType.FILL,
                    line_number=line_num,
                    constraints=constraints
                ))
                actions.append(ScriptAction(
                    action_type=ActionType.FILL,
                    target=selector,
                    line_number=line_num,
                    quality=self._assess_locator_quality(selector)
                ))

            # Extract press actions (for keyboard events)
            press_match = re.search(self.PATTERNS['press'], line_stripped)
            if press_match:
                selector = press_match.group(1)
                key = press_match.group(2) if len(press_match.groups()) > 1 else ""
                actions.append(ScriptAction(
                    action_type=ActionType.PRESS,
                    target=selector,
                    value=f"press:{key}",
                    line_number=line_num,
                    quality=self._assess_locator_quality(selector)
                ))

            # Extract click actions
            click_match = re.search(self.PATTERNS['click'], line_stripped)
            if click_match:
                selector = click_match.group(1)
                actions.append(ScriptAction(
                    action_type=ActionType.CLICK,
                    target=selector,
                    line_number=line_num,
                    quality=self._assess_locator_quality(selector)
                ))

            # Extract selectOption actions — group(1)=quote, group(2)=selector
            select_match = re.search(self.PATTERNS['selectOption'], line_stripped)
            if select_match:
                selector = select_match.group(2)
                input_fields.append(InputField(
                    selector=selector,
                    field_type=FieldType.SELECT,
                    field_name=self._extract_field_name(selector),
                    action=ActionType.SELECT_OPTION,
                    line_number=line_num
                ))
                actions.append(ScriptAction(
                    action_type=ActionType.SELECT_OPTION,
                    target=selector,
                    line_number=line_num,
                    quality=self._assess_locator_quality(selector)
                ))

            # Extract chained locator selectOption: page.locator('sel').selectOption(...)
            locator_select_match = re.search(self.PATTERNS['locator_select'], line_stripped)
            if locator_select_match:
                selector = locator_select_match.group(2)
                input_fields.append(InputField(
                    selector=selector,
                    field_type=FieldType.SELECT,
                    field_name=self._extract_field_name(selector),
                    action=ActionType.SELECT_OPTION,
                    line_number=line_num
                ))
                actions.append(ScriptAction(
                    action_type=ActionType.SELECT_OPTION,
                    target=selector,
                    line_number=line_num,
                    quality=self._assess_locator_quality(selector)
                ))

            # Extract check/uncheck actions — group(1)=quote, group(2)=selector
            check_match = re.search(self.PATTERNS['check'], line_stripped)
            if check_match:
                selector = check_match.group(2)
                input_fields.append(InputField(
                    selector=selector,
                    field_type=FieldType.CHECKBOX,
                    field_name=self._extract_field_name(selector),
                    action=ActionType.CHECK,
                    line_number=line_num
                ))
                actions.append(ScriptAction(
                    action_type=ActionType.CHECK,
                    target=selector,
                    line_number=line_num,
                    quality=self._assess_locator_quality(selector)
                ))

            # Extract chained locator check/uncheck: page.locator('sel').check(...)
            locator_check_match = re.search(self.PATTERNS['locator_check'], line_stripped)
            if locator_check_match:
                selector = locator_check_match.group(2)
                input_fields.append(InputField(
                    selector=selector,
                    field_type=FieldType.CHECKBOX,
                    field_name=self._extract_field_name(selector),
                    action=ActionType.CHECK,
                    line_number=line_num
                ))
                actions.append(ScriptAction(
                    action_type=ActionType.CHECK,
                    target=selector,
                    line_number=line_num,
                    quality=self._assess_locator_quality(selector)
                ))

            # Extract nth()/filter() chained fill/select/check
            for pat, ftype, atype in [
                ('locator_nth_fill',    None,              ActionType.FILL),
                ('locator_nth_select',  FieldType.SELECT,  ActionType.SELECT_OPTION),
                ('locator_nth_check',   FieldType.CHECKBOX,ActionType.CHECK),
                ('locator_filter_fill', None,              ActionType.FILL),
                ('locator_filter_select',FieldType.SELECT, ActionType.SELECT_OPTION),
                ('locator_filter_check',FieldType.CHECKBOX,ActionType.CHECK),
            ]:
                m = re.search(self.PATTERNS[pat], line_stripped)
                if m:
                    selector = m.group(2)
                    if ftype is None:
                        ft, fn, constraints = self._detect_field_info(selector, '')
                    else:
                        ft, fn, constraints = ftype, self._extract_field_name(selector), {}
                    input_fields.append(InputField(
                        selector=selector,
                        field_type=ft,
                        field_name=fn,
                        action=atype,
                        line_number=line_num,
                        constraints=constraints
                    ))
                    actions.append(ScriptAction(
                        action_type=atype,
                        target=selector,
                        line_number=line_num,
                        quality=self._assess_locator_quality(selector)
                    ))

            # Extract assertions
            expect_match = re.search(self.PATTERNS['expect'], line_stripped)
            if expect_match:
                assertion_type = 'unknown'
                expected_value = None
                
                # Detect assertion type
                if 'toBeVisible' in line_stripped:
                    assertion_type = 'visibility'
                elif 'toHaveText' in line_stripped:
                    assertion_type = 'text_content'
                    text_match = re.search(self.PATTERNS['toHaveText'], line_stripped)
                    if text_match:
                        expected_value = text_match.group(1)
                elif 'toHaveValue' in line_stripped:
                    assertion_type = 'value'
                    value_match = re.search(self.PATTERNS['toHaveValue'], line_stripped)
                    if value_match:
                        expected_value = value_match.group(1)
                elif 'toHaveURL' in line_stripped:
                    assertion_type = 'url'
                    url_match = re.search(self.PATTERNS['toHaveURL'], line_stripped)
                    if url_match:
                        expected_value = url_match.group(1)
                
                assertions.append({
                    'type': assertion_type,
                    'target': expect_match.group(1),
                    'expected_value': expected_value,
                    'full_line': line_stripped,
                    'line_number': line_num
                })

        # === DETERMINE TEST PATTERN ===
        detected_pattern = TestPattern.BASIC
        if has_component:
            detected_pattern = TestPattern.COMPONENT
        elif has_page_object:
            detected_pattern = TestPattern.PAGE_OBJECT
        elif has_fixtures:
            detected_pattern = TestPattern.FIXTURE
        elif has_data_driven:
            detected_pattern = TestPattern.DATA_DRIVEN
        elif has_api_hybrid:
            detected_pattern = TestPattern.API_HYBRID
        
        # === GENERATE ENHANCED SUMMARY ===
        detected_fields = list(set([f.field_name for f in input_fields]))
        field_types = {}
        for field in input_fields:
            field_types[field.field_type.value] = field_types.get(field.field_type.value, 0) + 1

        summary = {
            'total_inputs': len(input_fields),
            'total_actions': len(actions),
            'has_validation': len(assertions) > 0,
            'detected_fields': detected_fields,
            'field_type_distribution': field_types,
            'navigation_url': navigation_url,
            'lines_analyzed': len(lines),
            'modern_locators_used': any('getBy' in str(f.selector) for f in input_fields),
            'xpath_used': len(xpath_analysis) > 0,
            'xpath_count': len(xpath_analysis),
            'external_data_sources': len(external_data_sources),
            'test_pattern': detected_pattern.value if detected_pattern else 'basic',
            'has_hooks': test_context.has_hooks if test_context else False,
            'locator_quality': {
                'excellent': sum(1 for a in actions if a.quality == LocatorQuality.EXCELLENT),
                'good': sum(1 for a in actions if a.quality == LocatorQuality.GOOD),
                'fair': sum(1 for a in actions if a.quality == LocatorQuality.FAIR),
                'poor': sum(1 for a in actions if a.quality == LocatorQuality.POOR),
                'unstable': sum(1 for a in actions if a.quality == LocatorQuality.UNSTABLE),
            }
        }
        
        # === DEDUPLICATE input_fields (same selector+type+action) ===
        seen_fields: Set[tuple] = set()
        unique_fields = []
        for f in input_fields:
            key = (f.selector, f.field_type, f.action)
            if key not in seen_fields:
                seen_fields.add(key)
                unique_fields.append(f)
        input_fields = unique_fields

        # === CREATE ANALYSIS OBJECT ===
        analysis = ScriptAnalysis(
            input_fields=input_fields,
            actions=actions,
            navigation_url=navigation_url,
            assertions=assertions,
            summary=summary,
            xpath_analysis=xpath_analysis,
            external_data_sources=external_data_sources,
            test_context=test_context,
            interaction_patterns=interaction_patterns,
            detected_pattern=detected_pattern
        )
        
        # === CALCULATE QUALITY SCORE ===
        analysis.quality_score = self._calculate_quality_score(analysis)
        
        # === GENERATE PROACTIVE RECOMMENDATIONS ===
        analysis.recommendations = self._generate_recommendations(analysis)

        return analysis

    def _detect_field_info(self, selector: str, value: str = "") -> Tuple[FieldType, str, Dict]:
        """
        ENHANCED field type detection with intelligent constraints
        Analyzes selector, value, and context to infer field type and validation rules
        """
        lower_selector = selector.lower()
        lower_value = value.lower() if value else ""
        field_name = self._extract_field_name(selector)
        constraints = {}

        # ============ EMAIL PATTERNS ============
        email_keywords = ['email', 'mail', 'e-mail', 'correo', 'courriel']
        if any(keyword in lower_selector for keyword in email_keywords):
            constraints = {
                'pattern': r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$',
                'min_length': 5,  # a@b.c
                'max_length': 254,  # RFC 5321
                'required': True,
                'validation': 'email_format'
            }
            return FieldType.EMAIL, field_name, constraints

        # ============ PASSWORD PATTERNS ============
        password_keywords = ['password', 'pwd', 'pass', 'passwd', 'secret', 'pin', 'contraseña']
        if any(keyword in lower_selector for keyword in password_keywords):
            # Detect password strength requirements from context
            constraints = {
                'min_length': 8,
                'max_length': 128,
                'required': True,
                'security_level': 'medium',  # Can be: low, medium, high
                'patterns': {
                    'basic': r'^.{8,}$',
                    'medium': r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$',
                    'strong': r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{12,}$'
                }
            }
            return FieldType.PASSWORD, field_name, constraints

        # ============ PHONE/TEL PATTERNS ============
        phone_keywords = ['phone', 'tel', 'mobile', 'cell', 'telephone', 'fax', 'número', 'telefono']
        if any(keyword in lower_selector for keyword in phone_keywords):
            constraints = {
                'min_length': 7,   # Local numbers
                'max_length': 20,  # International + ext
                'pattern': r'^[0-9+\-\s().ext]+$',
                'formats': [
                    r'^\d{10}$',  # 1234567890
                    r'^\d{3}-\d{3}-\d{4}$',  # 123-456-7890
                    r'^\(\d{3}\)\s\d{3}-\d{4}$',  # (123) 456-7890
                    r'^\+\d{1,3}\s\d{10,14}$',  # +1 1234567890
                ]
            }
            return FieldType.TEL, field_name, constraints

        # ============ NUMBER/AMOUNT/CURRENCY PATTERNS ============
        number_keywords = ['amount', 'quantity', 'price', 'cost', 'age', 'number', 'balance', 
                          'transfer', 'salary', 'income', 'fee', 'total', 'subtotal', 'tax',
                          'discount', 'count', 'qty', 'valor', 'monto', 'precio']
        if any(keyword in lower_selector for keyword in number_keywords):
            # Detect if it's currency/decimal or integer
            is_currency = any(word in lower_selector for word in ['amount', 'price', 'cost', 'balance', 'transfer', 'salary', 'fee'])
            
            if is_currency:
                constraints = {
                    'min': 0.01,
                    'max': 999999999.99,
                    'min_length': 1,
                    'max_length': 15,
                    'pattern': r'^\d+(\.\d{1,2})?$',  # Decimal with 2 places
                    'type': 'decimal',
                    'currency_symbol': '$',
                    'decimal_places': 2
                }
            else:
                constraints = {
                    'min': 0,
                    'max': 999999999,
                    'pattern': r'^\d+$',  # Integer only
                    'type': 'integer'
                }
            return FieldType.NUMBER, field_name, constraints

        # ============ DATE/TIME PATTERNS ============
        date_keywords = ['date', 'birth', 'dob', 'birthday', 'anniversary', 'expire', 'expiry',
                        'valid', 'start', 'end', 'created', 'updated', 'fecha', 'nacimiento']
        if any(keyword in lower_selector for keyword in date_keywords):
            constraints = {
                'formats': [
                    'YYYY-MM-DD',
                    'MM/DD/YYYY',
                    'DD/MM/YYYY',
                    'DD-MM-YYYY'
                ],
                'pattern': r'^\d{4}-\d{2}-\d{2}$|^\d{2}/\d{2}/\d{4}$',
                'min_date': '1900-01-01',
                'max_date': '2100-12-31'
            }
            return FieldType.DATE, field_name, constraints

        # ============ URL/WEBSITE PATTERNS ============
        url_keywords = ['url', 'website', 'link', 'uri', 'web', 'site', 'domain', 'enlace']
        if any(keyword in lower_selector for keyword in url_keywords):
            constraints = {
                'pattern': r'^https?://[^\s]+$',
                'min_length': 10,
                'max_length': 2048,
                'protocols': ['http', 'https'],
                'validation': 'url_format'
            }
            return FieldType.URL, field_name, constraints

        # ============ SEARCH/QUERY PATTERNS ============
        search_keywords = ['search', 'query', 'find', 'lookup', 'filter', 'buscar', 'consulta']
        if any(keyword in lower_selector for keyword in search_keywords):
            constraints = {
                'min_length': 1,
                'max_length': 255,
                'allow_special_chars': True
            }
            return FieldType.SEARCH, field_name, constraints

        # ============ TEXTAREA/LONG TEXT PATTERNS ============
        textarea_keywords = ['textarea', 'comment', 'description', 'message', 'notes', 'bio',
                            'about', 'details', 'content', 'body', 'text', 'comentario', 'mensaje']
        if any(keyword in lower_selector for keyword in textarea_keywords):
            constraints = {
                'min_length': 0,
                'max_length': 5000,
                'multiline': True,
                'rich_text': False
            }
            return FieldType.TEXTAREA, field_name, constraints

        # ============ NAME PATTERNS (First/Last/Full) ============
        name_keywords = ['name', 'firstname', 'lastname', 'fullname', 'username', 'displayname',
                        'nombre', 'apellido', 'usuario']
        if any(keyword in lower_selector for keyword in name_keywords):
            constraints = {
                'min_length': 1,
                'max_length': 100,
                'pattern': r'^[a-zA-Z\s\'-]+$',  # Letters, spaces, hyphens, apostrophes
                'allow_unicode': True,  # For international names
                'validation': 'name_format'
            }
            return FieldType.TEXT, field_name, constraints

        # ============ ADDRESS PATTERNS ============
        address_keywords = ['address', 'street', 'city', 'state', 'zip', 'postal', 'country',
                           'dirección', 'ciudad', 'código']
        if any(keyword in lower_selector for keyword in address_keywords):
            constraints = {
                'min_length': 3,
                'max_length': 200,
                'allow_special_chars': True,
                'validation': 'address_format'
            }
            return FieldType.TEXT, field_name, constraints

        # ============ CVV / OTP / PIN / MFA PATTERNS ============
        cvv_keywords = ['cvv', 'cvc', 'cvv2', 'csc', 'security code']
        if any(keyword in lower_selector for keyword in cvv_keywords):
            constraints = {'min_length': 3, 'max_length': 4, 'pattern': r'^\d{3,4}$', 'masked': True, 'sensitive': True}
            return FieldType.NUMBER, field_name, constraints

        otp_keywords = ['otp', '2fa', 'mfa', 'totp', 'verification code', 'verificationcode', 'one-time', 'onetime']
        if any(keyword in lower_selector for keyword in otp_keywords):
            constraints = {'min_length': 4, 'max_length': 8, 'pattern': r'^\d{4,8}$', 'sensitive': True}
            return FieldType.NUMBER, field_name, constraints

        pin_keywords = ['pin', 'passcode', 'access code', 'accesscode']
        if any(keyword in lower_selector for keyword in pin_keywords):
            constraints = {'min_length': 4, 'max_length': 8, 'pattern': r'^\d{4,8}$', 'masked': True, 'sensitive': True}
            return FieldType.NUMBER, field_name, constraints

        # ============ CREDIT CARD PATTERNS ============
        # Relaxed: any card keyword alone is enough (e.g. #cardField, #creditCardNumber)
        card_keywords = ['card', 'credit', 'debit', 'payment', 'tarjeta', 'credito']
        if any(keyword in lower_selector for keyword in card_keywords):
            constraints = {
                'min_length': 13,
                'max_length': 19,
                'pattern': r'^\d{13,19}$',
                'validation': 'luhn_algorithm',
                'masked': True
            }
            return FieldType.NUMBER, field_name, constraints

        # ============ SSN/TAX ID PATTERNS ============
        ssn_keywords = ['ssn', 'social', 'security', 'tax', 'id', 'ein', 'nif', 'rut']
        if any(keyword in lower_selector for keyword in ssn_keywords):
            constraints = {
                'min_length': 9,
                'max_length': 11,
                'pattern': r'^\d{3}-\d{2}-\d{4}$|^\d{9}$',
                'masked': True,
                'sensitive': True
            }
            return FieldType.TEXT, field_name, constraints

        # ============ ZIP/POSTAL CODE PATTERNS ============
        zip_keywords = ['zip', 'postal', 'postcode', 'código postal']
        if any(keyword in lower_selector for keyword in zip_keywords):
            constraints = {
                'min_length': 5,
                'max_length': 10,
                'patterns': {
                    'US': r'^\d{5}(-\d{4})?$',  # 12345 or 12345-6789
                    'UK': r'^[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}$',  # SW1A 1AA
                    'CA': r'^[A-Z]\d[A-Z]\s?\d[A-Z]\d$'  # K1A 0B1
                }
            }
            return FieldType.TEXT, field_name, constraints

        # ============ USERNAME PATTERNS ============
        username_keywords = ['username', 'user', 'login', 'account', 'handle', 'usuario']
        if any(keyword in lower_selector for keyword in username_keywords):
            constraints = {
                'min_length': 3,
                'max_length': 30,
                'pattern': r'^[a-zA-Z0-9_.-]+$',
                'no_spaces': True,
                'validation': 'username_format'
            }
            return FieldType.TEXT, field_name, constraints

        # ============ COLOR PATTERNS ============
        if 'color' in lower_selector or 'colour' in lower_selector:
            constraints = {
                'pattern': r'^#[0-9A-Fa-f]{6}$|^rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\)$',
                'formats': ['hex', 'rgb', 'rgba', 'hsl']
            }
            return FieldType.TEXT, field_name, constraints

        # ============ FILE/UPLOAD PATTERNS ============
        file_keywords = ['file', 'upload', 'attach', 'document', 'image', 'photo', 'archivo']
        if any(keyword in lower_selector for keyword in file_keywords):
            constraints = {
                'max_file_size': 10485760,  # 10MB in bytes
                'allowed_extensions': ['.pdf', '.jpg', '.png', '.doc', '.docx', '.txt'],
                'mime_types': ['image/*', 'application/pdf', 'text/*']
            }
            return FieldType.TEXT, field_name, constraints

        # ============ TIME PATTERNS ============
        time_keywords = ['time', 'hour', 'minute', 'duration', 'hora']
        if any(keyword in lower_selector for keyword in time_keywords):
            constraints = {
                'pattern': r'^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$',  # HH:MM or HH:MM:SS
                'formats': ['HH:MM', 'HH:MM:SS', 'h:mm A'],
                '24_hour': True
            }
            return FieldType.TEXT, field_name, constraints

        # ============ PERCENTAGE PATTERNS ============
        if 'percent' in lower_selector or '%' in lower_selector or 'rate' in lower_selector:
            constraints = {
                'min': 0,
                'max': 100,
                'pattern': r'^\d+(\.\d{1,2})?$',
                'suffix': '%'
            }
            return FieldType.NUMBER, field_name, constraints

        # ============ DEFAULT TO TEXT ============
        # Generic text field with basic constraints
        constraints = {
            'min_length': 0,
            'max_length': 255,
            'allow_special_chars': True,
            'validation': 'text_format'
        }
        return FieldType.TEXT, field_name, constraints

    def _extract_field_name(self, selector: str) -> str:
        """
        Extract meaningful field name from selector
        Examples:
        - #username -> Username
        - [name="email"] -> Email
        - .input-password -> Password
        - input[data-testid="transfer-amount"] -> Transfer Amount
        """
        # Remove common prefixes and clean up
        name = selector
        # Extract value from attribute selectors like [name="email"] or [data-testid="transfer-amount"]
        attr_match = re.search(r'\[(?:name|id|data-testid|data-test-id|aria-label)=[\'"]?([^\'">\]]+)[\'"]?\]', name)
        if attr_match:
            name = attr_match.group(1)
        else:
            name = re.sub(r'^[#.\[]', '', name)          # Remove leading #, ., [
            name = re.sub(r'[\[\'"\]].*$', '', name)     # Remove trailing brackets/quotes and everything after
            name = re.sub(r'(?:name|id|data-testid)=', '', name)  # Remove attribute prefixes
        name = re.sub(r'[-_]', ' ', name)                # Replace - and _ with space
        name = re.sub(r'[^a-zA-Z0-9 ]', '', name)       # Strip any remaining special chars
        name = name.strip()

        # Capitalize words
        name = ' '.join(word.capitalize() for word in name.split())

        return name if name else 'Input Field'
    
    def _detect_action_from_line(self, line: str) -> Optional[ActionType]:
        """
        Detect what action is being performed on the line
        """
        if '.fill(' in line:
            return ActionType.FILL
        elif '.type(' in line:
            return ActionType.TYPE
        elif '.pressSequentially(' in line:
            return ActionType.FILL
        elif '.check(' in line:
            return ActionType.CHECK
        elif '.uncheck(' in line:
            return ActionType.UNCHECK
        elif '.click(' in line:
            return ActionType.CLICK
        elif '.selectOption(' in line:
            return ActionType.SELECT_OPTION
        elif '.hover(' in line:
            return ActionType.HOVER
        elif '.press(' in line:
            return ActionType.PRESS
        return None
    
    def _assess_locator_quality(self, selector: str) -> LocatorQuality:
        """
        Assess the quality and stability of a locator
        """
        selector_lower = selector.lower()
        
        # Test ID selectors are good
        if 'data-testid' in selector_lower or 'data-test-id' in selector_lower:
            return LocatorQuality.GOOD
        
        # ARIA attributes are good
        if 'aria-label' in selector_lower or 'role=' in selector_lower:
            return LocatorQuality.GOOD
        
        # Stable ID selectors (non-dynamic)
        if selector.startswith('#') and not re.search(r'#\w+-\d{6,}', selector):
            return LocatorQuality.FAIR
        
        # Dynamic-looking IDs or classes
        if re.search(r'[#.]\w+-[a-f0-9]{6,}', selector) or re.search(r'[#.]\w+-\d{6,}', selector):
            return LocatorQuality.UNSTABLE
        
        # XPath selectors
        if 'xpath=' in selector or selector.startswith('//'):
            if selector.count('/') > 5:  # Deep XPath
                return LocatorQuality.POOR
            elif re.search(r'\[\d+\]', selector):  # Positional
                return LocatorQuality.UNSTABLE
            return LocatorQuality.POOR
        
        # Generic class selectors
        if selector.startswith('.') and not any(semantic in selector_lower for semantic in ['btn', 'button', 'input', 'form', 'nav', 'header']):
            return LocatorQuality.FAIR
        
        # Semantic selectors
        if any(semantic in selector_lower for semantic in ['name=', 'placeholder=', 'type=', 'title=']):
            return LocatorQuality.FAIR
        
        return LocatorQuality.FAIR
    
    def _detect_field_from_role(self, role: str, name: Optional[str]) -> Tuple[FieldType, str, Dict]:
        """
        Detect field type from ARIA role
        """
        constraints = {}
        
        role_lower = role.lower()
        name_lower = name.lower() if name else ''
        
        # Map ARIA roles to field types
        if role_lower in ['textbox', 'searchbox']:
            if 'email' in name_lower:
                return FieldType.EMAIL, name or 'Email', {'pattern': r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', 'max_length': 254}
            elif 'password' in name_lower:
                return FieldType.PASSWORD, name or 'Password', {'min_length': 8, 'max_length': 128}
            elif 'search' in name_lower or role_lower == 'searchbox':
                return FieldType.SEARCH, name or 'Search', {}
            else:
                return FieldType.TEXT, name or 'Text Input', {}
        
        elif role_lower in ['checkbox', 'switch']:
            return FieldType.CHECKBOX, name or 'Checkbox', {}

        elif role_lower == 'radio':
            return FieldType.RADIO, name or 'Radio', {}
        
        elif role_lower == 'combobox' or role_lower == 'listbox':
            return FieldType.SELECT, name or 'Select', {}
        
        elif role_lower == 'spinbutton':
            return FieldType.NUMBER, name or 'Number', {}
        
        # Default to text for input-like roles
        return FieldType.TEXT, name or role, constraints
    
    def _analyze_xpath(self, xpath: str, xpath_type: XPathType, line_number: int) -> XPathAnalysis:
        """
        ENHANCED Deep analysis of XPath selector with sophisticated scoring
        Returns complexity score, stability score, and recommendations
        """
        issues = []
        complexity_score = 0
        stability_score = 100
        recommended_alternative = None
        
        # ============ ENHANCED COMPLEXITY ANALYSIS ============
        # Base complexity from predicates (brackets)
        predicate_count = xpath.count('[')
        complexity_score += predicate_count * 8  # Reduced from 10
        
        # Hierarchy depth complexity
        level_count = xpath.count('/')
        if level_count > 6:
            complexity_score += level_count * 8  # Deep hierarchies are very complex
        elif level_count > 4:
            complexity_score += level_count * 6
        else:
            complexity_score += level_count * 4
        
        # Axes complexity (:: operators)
        axes_count = xpath.count('::')
        complexity_score += axes_count * 12  # Axes are advanced and complex
        
        # Function complexity
        function_count = len(re.findall(r'(contains|starts-with|normalize-space|text|concat|substring)\(', xpath))
        complexity_score += function_count * 10
        
        # Logical operators complexity
        logical_count = len(re.findall(r'\b(and|or|not)\b', xpath))
        complexity_score += logical_count * 7
        
        # Attribute complexity
        attribute_count = xpath.count('@') - xpath.count('@data-testid') - xpath.count('@aria-')  # Exclude good attributes
        complexity_score += max(0, attribute_count * 5)
        
        # Absolute XPath complexity penalty
        if xpath_type == XPathType.ABSOLUTE:
            complexity_score += 25  # Reduced from 30
            stability_score -= 35  # Reduced from 40
            issues.append("Absolute XPath is brittle - breaks easily with DOM changes")
            recommended_alternative = "Use getByRole(), getByLabel(), or getByTestId() instead"
        
        # ============ ENHANCED STABILITY ANALYSIS ============
        
        # Positional selectors (most unstable)
        positional_matches = re.findall(r'\[(\d+)\]', xpath)
        if positional_matches:
            position_count = len(positional_matches)
            # Higher penalty for multiple positions
            stability_score -= min(40, position_count * 15 + 10)
            if position_count == 1:
                issues.append("Positional selector (e.g., [1]) is unstable - position may change")
            else:
                issues.append(f"{position_count} positional selectors detected - highly fragile")
        
        # Generic tag names without attributes
        generic_tags = re.findall(r'//(div|span|p|a|section|article|header|footer|nav)(?![\w\[])', xpath)
        if generic_tags:
            unique_generics = set(generic_tags)
            stability_score -= min(25, len(unique_generics) * 8)
            issues.append(f"Generic tags ({', '.join(unique_generics)}) without attributes are unstable")
        
        # Dynamic ID/class patterns (CSS-in-JS, generated IDs)
        if re.search(r'@id=[\'"]\\w*-(\\d{6,}|[a-f0-9]{6,})', xpath):
            stability_score -= 30
            issues.append("Dynamic ID detected (appears auto-generated) - will change between deployments")
        
        if re.search(r'@class=[\'"]\\w*-(css|sc|jss|emotion|styled)-[\\w]{6,}', xpath):
            stability_score -= 35
            issues.append("CSS-in-JS class detected - changes on every build")
        
        if re.search(r'@class=[\'"]\\w*-\\w{6,}[\'"]', xpath):
            stability_score -= 20
            issues.append("Appears to use auto-generated classes - may be unstable")
        
        # Text-based selectors (moderately unstable)
        if 'text()' in xpath:
            stability_score -= 15
            issues.append("Text-based XPath - may break if text content changes (translations, updates)")
        
        # Contains() function (better than exact text, but still text-dependent)
        if 'contains(' in xpath:
            stability_score -= 10
            issues.append("Using contains() - better than exact text but still dependent on content")
        
        # Deep hierarchy penalty
        if level_count > 8:
            stability_score -= 20
            issues.append(f"Very deep hierarchy ({level_count} levels) - likely to break with layout changes")
        elif level_count > 5:
            stability_score -= 10
            issues.append(f"Deep hierarchy ({level_count} levels) - may break with DOM restructuring")
        
        # ============ POSITIVE SCORING FOR GOOD PRACTICES ============
        
        # Data-testid (best practice)
        if '@data-testid' in xpath:
            stability_score += 25
            complexity_score -= 15
            issues.append("✅ GOOD: Uses data-testid attribute (stable and recommended)")
        
        # ARIA attributes (accessibility + stability)
        aria_attrs = re.findall(r'@aria-(label|labelledby|describedby|role)', xpath)
        if aria_attrs:
            stability_score += 20
            complexity_score -= 10
            issues.append(f"✅ GOOD: Uses ARIA attributes ({', '.join(set(aria_attrs))}) - accessible and stable")
        
        # Role attribute (semantic)
        if '@role=' in xpath:
            stability_score += 15
            complexity_score -= 8
            issues.append("✅ GOOD: Uses role attribute - semantic and relatively stable")
        
        # ID attribute (if not dynamic)
        if '@id=' in xpath and not re.search(r'@id=[\'"]\\w*-\\d{6,}', xpath):
            stability_score += 10
            issues.append("Uses stable ID attribute (appears non-dynamic)")
        
        # Name attribute (form elements)
        if '@name=' in xpath:
            stability_score += 8
            issues.append("Uses name attribute - generally stable for form elements")
        
        # Placeholder (stable for inputs)
        if '@placeholder=' in xpath:
            stability_score += 12
            recommended_alternative = recommended_alternative or "Consider getByPlaceholder() for better readability"
        
        # Type attribute (stable for inputs)
        if '@type=' in xpath:
            stability_score += 5
        
        # ============ RECOMMENDATIONS ============
        
        # Recommend specific alternatives based on attributes found
        if '@data-testid=' in xpath and not recommended_alternative:
            recommended_alternative = "Already using data-testid! Consider getByTestId() for cleaner syntax"
        elif '@aria-label=' in xpath and not recommended_alternative:
            recommended_alternative = "Consider getByRole() with { name: '...' } option"
        elif '@placeholder=' in xpath and not recommended_alternative:
            recommended_alternative = "Use getByPlaceholder() instead"
        elif '@role=' in xpath and not recommended_alternative:
            recommended_alternative = "Use getByRole() instead"
        elif 'text()' in xpath and not recommended_alternative:
            recommended_alternative = "Use getByText() instead"
        elif '@name=' in xpath and not recommended_alternative:
            recommended_alternative = "Use getByLabel() or getByRole() instead"
        elif not recommended_alternative:
            recommended_alternative = "Use getByRole(), getByLabel(), getByPlaceholder(), or getByTestId() instead"
        
        # ============ FINAL SCORE ADJUSTMENTS ============
        
        # Bonus for short, simple XPaths
        if level_count <= 3 and predicate_count <= 2:
            complexity_score = max(0, complexity_score - 10)
        
        # Cap scores to 0-100 range
        complexity_score = min(100, max(0, complexity_score))
        stability_score = min(100, max(0, stability_score))
        
        return XPathAnalysis(
            xpath=xpath,
            xpath_type=xpath_type,
            complexity_score=complexity_score,
            stability_score=stability_score,
            recommended_alternative=recommended_alternative,
            issues=issues,
            line_number=line_number
        )
    
    def _calculate_quality_score(self, analysis: ScriptAnalysis) -> int:
        """
        Calculate overall script quality score (0-100)
        Based on locator quality, test patterns, and best practices
        """
        score = 50  # Base score
        
        # Bonus for modern locators
        modern_locator_count = sum(1 for a in analysis.actions if a.quality == LocatorQuality.EXCELLENT)
        if analysis.actions:
            modern_ratio = modern_locator_count / len(analysis.actions)
            score += int(modern_ratio * 20)
        
        # Penalty for XPath usage
        if analysis.xpath_analysis:
            avg_xpath_stability = sum(x.stability_score for x in analysis.xpath_analysis) / len(analysis.xpath_analysis)
            score -= int((100 - avg_xpath_stability) / 5)
        
        # Bonus for test patterns
        if analysis.detected_pattern == TestPattern.PAGE_OBJECT:
            score += 10
        if analysis.detected_pattern == TestPattern.FIXTURE:
            score += 8
        if analysis.detected_pattern == TestPattern.DATA_DRIVEN:
            score += 12
        
        # Bonus for assertions
        if analysis.assertions:
            score += min(10, len(analysis.assertions) * 2)
        
        # Bonus for test context
        if analysis.test_context:
            if analysis.test_context.has_hooks:
                score += 5
            if analysis.test_context.timeout:
                score += 3
            if analysis.test_context.retries:
                score += 3
        
        return min(100, max(0, score))
    
    def _generate_recommendations(self, analysis: ScriptAnalysis) -> List[Dict[str, Any]]:
        """
        Generate proactive recommendations for script improvement
        """
        recommendations = []
        
        # XPath recommendations
        if analysis.xpath_analysis:
            for xpath_item in analysis.xpath_analysis:
                if xpath_item.stability_score < 60:
                    recommendations.append({
                        'priority': 'high',
                        'category': 'locator_stability',
                        'title': f'Unstable XPath detected (line {xpath_item.line_number})',
                        'description': f"XPath '{xpath_item.xpath[:50]}...' has low stability score ({xpath_item.stability_score}/100)",
                        'suggestion': xpath_item.recommended_alternative or 'Consider using role-based or test-id locators',
                        'issues': xpath_item.issues
                    })
        
        # Modern locator recommendation
        poor_locators = [a for a in analysis.actions if a.quality in [LocatorQuality.POOR, LocatorQuality.UNSTABLE]]
        if len(poor_locators) > 3:
            recommendations.append({
                'priority': 'medium',
                'category': 'modern_locators',
                'title': f'{len(poor_locators)} locators could be improved',
                'description': 'Several locators are using legacy or unstable selectors',
                'suggestion': 'Migrate to modern Playwright locators: getByRole(), getByLabel(), getByPlaceholder()'
            })
        
        # Missing assertions
        if not analysis.assertions:
            recommendations.append({
                'priority': 'high',
                'category': 'test_quality',
                'title': 'No assertions detected',
                'description': 'Test should include explicit assertions to validate expected behavior',
                'suggestion': 'Add expect() assertions to verify outcomes: toBeVisible(), toHaveText(), toHaveURL()'
            })
        
        # Missing test hooks
        if analysis.test_context and not analysis.test_context.has_hooks:
            recommendations.append({
                'priority': 'low',
                'category': 'test_structure',
                'title': 'Consider using test hooks',
                'description': 'beforeEach/afterEach hooks can improve test maintainability',
                'suggestion': 'Use beforeEach() for common setup and afterEach() for cleanup'
            })
        
        # External data recommendation
        if not analysis.external_data_sources and len(analysis.input_fields) > 5:
            recommendations.append({
                'priority': 'medium',
                'category': 'data_driven',
                'title': 'Consider data-driven testing',
                'description': f'{len(analysis.input_fields)} input fields detected with hardcoded values',
                'suggestion': 'Extract test data to JSON/CSV files for better maintainability and coverage'
            })
        
        # Pattern recommendation
        if not analysis.detected_pattern or analysis.detected_pattern == TestPattern.BASIC:
            if len(analysis.input_fields) > 10:
                recommendations.append({
                    'priority': 'medium',
                    'category': 'test_pattern',
                    'title': 'Consider Page Object Model',
                    'description': 'Large test script could benefit from POM pattern',
                    'suggestion': 'Refactor into Page Objects to improve reusability and maintenance'
                })
        
        return recommendations

    def generate_test_data_recommendations(self, analysis: ScriptAnalysis) -> Dict[str, Any]:
        """
        Generate test data recommendations based on script analysis
        """
        recommendations = {
            'security_tests': [],
            'boundary_tests': [],
            'equivalence_tests': []
        }

        for field in analysis.input_fields:
            # Security test recommendations
            if field.field_type in [FieldType.TEXT, FieldType.EMAIL, FieldType.PASSWORD, FieldType.TEXTAREA]:
                recommendations['security_tests'].append({
                    'field': field.selector,
                    'field_name': field.field_name,
                    'test_types': ['sql_injection', 'xss_attack', 'command_injection'],
                    'priority': 'high' if field.field_type == FieldType.PASSWORD else 'medium'
                })

            # Boundary value test recommendations
            if field.field_type == FieldType.NUMBER:
                recommendations['boundary_tests'].append({
                    'field': field.selector,
                    'field_name': field.field_name,
                    'field_type': 'number',
                    'min_value': 0,
                    'max_value': 999999.99 if 'amount' in field.field_name.lower() else 100,
                    'test_values': ['min', 'min-1', 'min+1', 'max', 'max+1', 'max-1', 'zero', 'negative']
                })

            if field.field_type in [FieldType.TEXT, FieldType.EMAIL]:
                recommendations['boundary_tests'].append({
                    'field': field.selector,
                    'field_name': field.field_name,
                    'field_type': 'string',
                    'min_length': field.min_length or 1,
                    'max_length': field.max_length or 255,
                    'test_values': ['min_length', 'max_length', 'empty', 'too_long']
                })

            # Equivalence partitioning recommendations
            if 'amount' in field.field_name.lower() or 'transfer' in field.field_name.lower():
                recommendations['equivalence_tests'].append({
                    'field': field.selector,
                    'field_name': field.field_name,
                    'partition_type': 'transferAmount',
                    'partitions': {
                        'valid': ['small_transfer', 'medium_transfer', 'large_transfer'],
                        'invalid': ['negative_amount', 'zero_amount', 'exceeds_limit']
                    }
                })

            if field.field_type == FieldType.EMAIL:
                recommendations['equivalence_tests'].append({
                    'field': field.selector,
                    'field_name': field.field_name,
                    'partition_type': 'email',
                    'partitions': {
                        'valid': ['standard_email', 'email_with_plus', 'email_with_subdomain'],
                        'invalid': ['missing_at', 'missing_domain', 'invalid_tld']
                    }
                })

        return recommendations


# Singleton instance
script_analyzer = PlaywrightScriptAnalyzer()


# Test function
if __name__ == "__main__":
    # Example Playwright script
    sample_script = """
    import { test, expect } from '@playwright/test';

    test('Bank transfer test', async ({ page }) => {
        await page.goto('https://bank.example.com/transfer');
        await page.fill('#amount', '1000');
        await page.fill('#recipient-email', 'john@example.com');
        await page.fill('#password', 'secret123');
        await page.selectOption('#account-type', 'savings');
        await page.click('#submit-button');
        await expect(page.locator('.success-message')).toBeVisible();
    });
    """

    analyzer = PlaywrightScriptAnalyzer()
    analysis = analyzer.analyze(sample_script)
    recommendations = analyzer.generate_test_data_recommendations(analysis)

    print("=== SCRIPT ANALYSIS ===")
    print(json.dumps(analysis.to_dict(), indent=2))
    print("\n=== TEST DATA RECOMMENDATIONS ===")
    print(json.dumps(recommendations, indent=2))
