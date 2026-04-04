export class CatalogueItemData {
  id: number = 0;
  title: Resource = $r('app.string.responsive_layout');
  uri: string = '';
  params?: string;

  constructor(id: number, title: Resource, uri: string, params?: string) {
    this.id = id;
    this.title = title;
    this.uri = uri;
    this.params = params;
  }
}