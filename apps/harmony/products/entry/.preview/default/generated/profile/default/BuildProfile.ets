/**
 * Use these variables when you tailor your ArkTS code. They must be of the const type.
 */
export const BUNDLE_NAME = 'com.audiodock.app';
export const BUNDLE_TYPE = 'app';
export const VERSION_CODE = 8;
export const VERSION_NAME = '1.2.4';
export const TARGET_NAME = 'default';
export const PRODUCT_NAME = 'default';
export const BUILD_MODE_NAME = 'release';
export const DEBUG = false;

/**
 * BuildProfile Class is used only for compatibility purposes.
 */
export default class BuildProfile { 
	static readonly BUNDLE_NAME = BUNDLE_NAME;
	static readonly BUNDLE_TYPE = BUNDLE_TYPE;
	static readonly VERSION_CODE = VERSION_CODE;
	static readonly VERSION_NAME = VERSION_NAME;
	static readonly TARGET_NAME = TARGET_NAME;
	static readonly PRODUCT_NAME = PRODUCT_NAME;
	static readonly BUILD_MODE_NAME = BUILD_MODE_NAME;
	static readonly DEBUG = DEBUG;
}