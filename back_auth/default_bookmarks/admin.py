from django.contrib import admin

from .models import DefaultCategory, DefaultBookmark


class BookmarkInLine(admin.TabularInline):
    model = DefaultBookmark
    extra = 0


class CategoryAdmin(admin.ModelAdmin):
    inlines = [
        BookmarkInLine,
    ]
    list_display = ('title', )


class BookmarkAdmin(admin.ModelAdmin):
    list_display = ('name', 'category', 'url')
    list_filter = ('category',)


admin.site.register(DefaultCategory, CategoryAdmin)
admin.site.register(DefaultBookmark, BookmarkAdmin)
